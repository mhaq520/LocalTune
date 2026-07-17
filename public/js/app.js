function encodePath(p) {
  return p.split('/').map((s) => encodeURIComponent(s)).join('/');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

let projectListRequestSeq = 0;
let projectDetailRequestSeq = 0;
let directoryRequestSeq = 0;
let currentViewSeq = 0;

const gridView = document.getElementById('gridView');
const detailView = document.getElementById('detailView');

function showGrid() {
  detailView.classList.add('hidden');
  gridView.classList.remove('hidden');
}

function showDetail() {
  gridView.classList.add('hidden');
  detailView.classList.remove('hidden');
}

async function loadProjects() {
  const requestSeq = ++projectListRequestSeq;
  const grid = document.getElementById('projectGrid');
  grid.innerHTML = '<div class="loading">正在扫描音乐目录...</div>';

  try {
    const res = await fetch('/api/projects');
    const data = await res.json();
    if (requestSeq !== projectListRequestSeq) return;

    if (data.error) {
      grid.innerHTML = `<div class="empty">${escapeHtml(data.error)}</div>`;
      return;
    }

    const projects = data.projects || [];
    const projectCount = document.getElementById('projectCount');
    if (projectCount) {
      projectCount.textContent = `${projects.length} 个项目`;
    }

    if (projects.length === 0) {
      grid.innerHTML = '<div class="empty">未找到项目文件夹</div>';
      return;
    }

    grid.innerHTML = projects.map((p) => {
      const displayName = p.rjCode || p.chineseName || p.name;
      const imgSrc = p.coverPath
        ? `/api/thumbnail?path=${encodeURIComponent(p.coverPath)}&size=400`
        : '/assets/default-cover.png';

      return `
        <div class="card" onclick="openProject('${escapeAttr(p.id)}')">
          <img class="card-img" src="${imgSrc}" alt="${escapeHtml(displayName)}" loading="lazy">
          ${p.rjCode ? `<span class="card-rj">${escapeHtml(p.rjCode)}</span>` : ''}
          <div class="card-body">
            <div class="card-title">${escapeHtml(p.chineseName || p.name)}</div>
          </div>
          <span class="card-badge">${p.audioCount} 首</span>
        </div>
      `;
    }).join('');
  } catch (err) {
    if (requestSeq !== projectListRequestSeq) return;
    grid.innerHTML = `<div class="empty">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

window.openProject = function (id) {
  showDetail();
  loadProjectDetail(id);
};

let currentProjectId = '';
let currentPath = '';
let audioFiles = [];
let projectInfo = null;

document.getElementById('backBtn').addEventListener('click', () => {
  showGrid();
});

document.getElementById('breadcrumb').addEventListener('click', (e) => {
  const item = e.target.closest('.breadcrumb-item');
  if (item) {
    navigateTo(item.dataset.path || '');
  }
});

async function loadProjectDetail(projectId) {
  const viewSeq = ++currentViewSeq;
  const requestSeq = ++projectDetailRequestSeq;

  try {
    const res = await fetch(`/api/browse/${encodeURIComponent(projectId)}`);
    const data = await res.json();
    if (requestSeq !== projectDetailRequestSeq || viewSeq !== currentViewSeq) return;

    if (data.error) {
      document.getElementById('fileList').innerHTML = `<div class="loading">${escapeHtml(data.error)}</div>`;
      return;
    }

    currentProjectId = projectId;
    currentPath = '';
    projectInfo = data;
    document.getElementById('projectTitle').textContent = data.chineseName || data.name;
    document.getElementById('projectSubtitle').textContent = data.name;

    const hasMain = Array.isArray(data.dirs) && data.dirs.some((d) => d.name === '正篇');
    if (hasMain) {
      navigateTo('正篇', projectId, viewSeq);
    } else {
      navigateTo('', projectId, viewSeq);
    }
  } catch (err) {
    if (requestSeq !== projectDetailRequestSeq || viewSeq !== currentViewSeq) return;
    document.getElementById('fileList').innerHTML = `<div class="loading">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

async function navigateTo(subPath, projectId = currentProjectId, viewSeq = currentViewSeq) {
  if (!projectId) return;
  currentPath = subPath || '';
  updateBreadcrumb(currentPath);
  await loadDirectory(currentPath, projectId, viewSeq);
}

function updateBreadcrumb(subPath) {
  const bc = document.getElementById('breadcrumb');
  const rootName = projectInfo ? (projectInfo.chineseName || projectInfo.name) : '根目录';
  let html = `<span class="breadcrumb-item${subPath === '' ? ' active' : ''}" data-path="">${escapeHtml(rootName)}</span>`;

  if (subPath) {
    const parts = subPath.replace(/\\/g, '/').split('/').filter(Boolean);
    let accumulated = '';
    for (const part of parts) {
      accumulated += (accumulated ? '/' : '') + part;
      const isLast = accumulated === subPath;
      html += ` <span class="sep">/</span> <span class="breadcrumb-item${isLast ? ' active' : ''}" data-path="${escapeAttr(accumulated)}">${escapeHtml(part)}</span>`;
    }
  }

  bc.innerHTML = html;
}

async function loadDirectory(subPath, projectId = currentProjectId, viewSeq = currentViewSeq) {
  const requestSeq = ++directoryRequestSeq;
  const container = document.getElementById('fileList');
  const requestedPath = subPath || '';
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const url = requestedPath
      ? `/api/browse/${encodeURIComponent(projectId)}/${encodePath(requestedPath)}`
      : `/api/browse/${encodeURIComponent(projectId)}`;

    const res = await fetch(url);
    const data = await res.json();
    if (
      requestSeq !== directoryRequestSeq ||
      viewSeq !== currentViewSeq ||
      projectId !== currentProjectId ||
      requestedPath !== currentPath
    ) {
      return;
    }

    if (data.error) {
      container.innerHTML = `<div class="loading">${escapeHtml(data.error)}</div>`;
      return;
    }

    audioFiles = (data.files || []).filter((f) => f.type === 'audio').map((f) => ({
      ...f,
      relPath: requestedPath ? `${requestedPath}/${f.name}` : f.name
    }));

    Player.setPlaylist(projectId, audioFiles, requestedPath);
    renderFileList(data.dirs || [], data.files || [], requestedPath);
    Player.updateNowPlaying();
    Player.updateTrackListHighlight();
    loadLyricsForCurrent();
  } catch (err) {
    if (requestSeq !== directoryRequestSeq || viewSeq !== currentViewSeq) return;
    container.innerHTML = `<div class="loading">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

function renderFileList(dirs, files, subPath) {
  const container = document.getElementById('fileList');
  let html = '';
  let audioIdx = 0;

  for (const d of dirs) {
    const subDirPath = subPath ? `${subPath}/${d.name}` : d.name;
    html += `
      <div class="file-item dir-item" onclick="navigateTo('${escapeAttr(subDirPath)}')">
        <span class="file-icon">📁</span>
        <span class="file-name">${escapeHtml(d.name)}</span>
      </div>`;
  }

  if (files.length === 0 && dirs.length === 0) {
    html += '<div class="empty-dir">此目录为空</div>';
  } else {
    for (const f of files) {
      const isAudio = f.type === 'audio';
      const icon = isAudio ? '🎵' : (f.type === 'image' ? '🖼' : (f.type === 'lyrics' ? '📝' : '📄'));

      if (isAudio) {
        const idx = audioIdx++;
        html += `
          <div class="file-item audio-item" data-audio-index="${idx}" onclick="playTrack(${idx})">
            <span class="file-icon">${icon}</span>
            <span class="file-name">${escapeHtml(f.name)}</span>
            ${f.lrcPath ? '<span class="track-lrc-badge">词</span>' : ''}
            <span class="track-status"></span>
          </div>`;
      } else if (f.type === 'image') {
        const relPath = subPath ? `${subPath}/${f.name}` : f.name;
        html += `
          <div class="file-item image-item" onclick="previewImage('${escapeAttr(relPath)}')">
            <span class="file-icon">${icon}</span>
            <span class="file-name">${escapeHtml(f.name)}</span>
            <span class="track-status">预览</span>
          </div>`;
      } else {
        html += `
          <div class="file-item">
            <span class="file-icon">${icon}</span>
            <span class="file-name file-other">${escapeHtml(f.name)}</span>
          </div>`;
      }
    }
  }

  container.innerHTML = html;
}

window.playTrack = function (index) {
  Player.play(index);
  void loadLyricsForCurrent();
};

function loadLyricsForCurrent() {
  const track = audioFiles[Player.currentIndex];
  if (track && track.lrcPath) {
    let lrcRelPath;
    if (track.lrcPath.includes('/') || track.lrcPath.includes('\\')) {
      lrcRelPath = track.lrcPath.replace(/\\/g, '/');
    } else {
      lrcRelPath = currentPath ? `${currentPath}/${track.lrcPath}` : track.lrcPath;
    }
    void Lyrics.load(`/api/lyrics/${encodeURIComponent(currentProjectId)}/${encodePath(lrcRelPath)}`);
  } else {
    void Lyrics.load(null);
  }
}

document.getElementById('playBtn').addEventListener('click', () => {
  if (!Player.audio.src && Player.playlist.length > 0) {
    window.playTrack(0);
  } else {
    Player.togglePlay();
  }
});

document.getElementById('prevBtn').addEventListener('click', () => {
  Player.prev();
  loadLyricsForCurrent();
});

document.getElementById('nextBtn').addEventListener('click', () => {
  Player.next();
  loadLyricsForCurrent();
});

document.getElementById('progressBar').addEventListener('input', (e) => {
  Player.seek(e.target.value);
});

document.getElementById('volumeBar').addEventListener('input', (e) => {
  Player.setVolume(e.target.value);
});

document.getElementById('lyricsToggleBtn').addEventListener('click', () => Lyrics.toggle());
document.getElementById('lyricsCloseBtn').addEventListener('click', () => Lyrics.toggle());
Lyrics.initDrag();
Lyrics.init();

const imageOverlay = document.getElementById('imageOverlay');
const imagePreview = document.getElementById('imagePreview');
if (imageOverlay) {
  imageOverlay.addEventListener('click', (e) => {
    if (e.target === imageOverlay || e.target.id === 'imageCloseBtn') {
      imageOverlay.classList.add('hidden');
      if (imagePreview) {
        imagePreview.src = '';
      }
    }
  });
}

document.addEventListener('keydown', (e) => {
  const tagName = e.target && e.target.tagName;
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || (e.target && e.target.isContentEditable)) {
    return;
  }

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      if (Player.audio) {
        Player.togglePlay();
      }
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (Player.audio) {
        Player.audio.currentTime = Math.max(0, (Player.audio.currentTime || 0) - 5);
      }
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (Player.audio && Player.audio.duration) {
        Player.audio.currentTime = Math.min(Player.audio.duration, (Player.audio.currentTime || 0) + 5);
      }
      break;
  }
});

window.previewImage = function (relPath) {
  if (!imageOverlay || !imagePreview) return;
  const url = `/api/image/${encodeURIComponent(currentProjectId)}/${encodePath(relPath)}`;
  imagePreview.src = url;
  imageOverlay.classList.remove('hidden');
};

document.getElementById('miniBtn').addEventListener('click', () => {
  document.getElementById('playerBar').style.display = 'none';
  document.getElementById('miniPlayer').classList.remove('hidden');
});

document.getElementById('miniExpandBtn').addEventListener('click', () => {
  document.getElementById('miniPlayer').classList.add('hidden');
  document.getElementById('playerBar').style.display = '';
});

document.getElementById('miniPlayBtn').addEventListener('click', () => {
  Player.togglePlay();
});

document.getElementById('refreshBtn').addEventListener('click', async () => {
  const btn = document.getElementById('refreshBtn');
  btn.textContent = '刷新中...';
  btn.disabled = true;
  try {
    await fetch('/api/refresh');
    await loadProjects();
  } finally {
    btn.textContent = '刷新';
    btn.disabled = false;
  }
});

document.getElementById('settingsBtn').addEventListener('click', async () => {
  if (window.electronAPI && window.electronAPI.invoke) {
    try {
      await window.electronAPI.invoke('settings:open');
    } catch (e) {
      /* ignore */
    }
  } else {
    window.location.href = '/settings.html';
  }
});

document.addEventListener('trackChanged', () => {
  loadLyricsForCurrent();
});

loadProjects();
