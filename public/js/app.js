// ========== 工具函数 ==========
// 编码路径（每段分别 encodeURIComponent，保留 /）
function encodePath(p) {
  return p.split('/').map(s => encodeURIComponent(s)).join('/');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ========== 视图切换 ==========
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

// ========== 网格视图 ==========
async function loadProjects() {
  const grid = document.getElementById('projectGrid');
  grid.innerHTML = '<div class="loading">正在扫描音乐目录...</div>';

  try {
    const res = await fetch('/api/projects');
    const data = await res.json();

    if (data.error) {
      grid.innerHTML = `<div class="empty">${escapeHtml(data.error)}</div>`;
      return;
    }

    const projects = data.projects;
    document.getElementById('projectCount').textContent = `${projects.length} 个项目`;

    if (projects.length === 0) {
      grid.innerHTML = '<div class="empty">未找到项目文件夹</div>';
      return;
    }

    grid.innerHTML = projects.map(p => {
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
    grid.innerHTML = `<div class="empty">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

window.openProject = function (id) {
  showDetail();
  loadProjectDetail(id);
};

// ========== 详情视图 ==========
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
  currentProjectId = projectId;
  currentPath = '';
  projectInfo = null;

  try {
    const res = await fetch(`/api/browse/${encodeURIComponent(projectId)}`);
    const data = await res.json();

    if (data.error) {
      document.getElementById('fileList').innerHTML = `<div class="loading">${escapeHtml(data.error)}</div>`;
      return;
    }

    projectInfo = data;
    document.getElementById('projectTitle').textContent = data.chineseName || data.name;
    document.getElementById('projectSubtitle').textContent = data.name;

    // 如果有正篇目录，直接进入
    const hasMain = data.dirs.some(d => d.name === '正篇');
    if (hasMain) {
      navigateTo('正篇');
    } else {
      navigateTo('');
    }
  } catch (err) {
    document.getElementById('fileList').innerHTML = `<div class="loading">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

async function navigateTo(subPath) {
  currentPath = subPath;
  updateBreadcrumb(subPath);
  await loadDirectory(subPath);
}

function updateBreadcrumb(subPath) {
  const bc = document.getElementById('breadcrumb');
  let html = `<span class="breadcrumb-item${subPath === '' ? ' active' : ''}" data-path="">${projectInfo ? (projectInfo.chineseName || projectInfo.name) : '根目录'}</span>`;

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

async function loadDirectory(subPath) {
  const container = document.getElementById('fileList');
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const url = subPath
      ? `/api/browse/${encodeURIComponent(currentProjectId)}/${encodePath(subPath)}`
      : `/api/browse/${encodeURIComponent(currentProjectId)}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      container.innerHTML = `<div class="loading">${escapeHtml(data.error)}</div>`;
      return;
    }

    // 收集音频文件
    audioFiles = data.files.filter(f => f.type === 'audio').map(f => ({
      ...f,
      relPath: subPath ? `${subPath}/${f.name}` : f.name
    }));
    Player.setPlaylist(currentProjectId, audioFiles);

    renderFileList(data.dirs, data.files, subPath);
  } catch (err) {
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

// ========== 播放控制 ==========
window.playTrack = function (index) {
  Player.play(index);
  loadLyricsForCurrent();
};

// navigateTo 已经是顶层函数声明，自动挂载到 window，不需要再赋值

function loadLyricsForCurrent() {
  const track = audioFiles[Player.currentIndex];
  if (track && track.lrcPath) {
    // lrcPath 可能是相对路径（如 "正篇/song.lrc"）或纯文件名
    let lrcRelPath;
    if (track.lrcPath.includes('/') || track.lrcPath.includes('\\')) {
      lrcRelPath = track.lrcPath.replace(/\\/g, '/');
    } else {
      lrcRelPath = currentPath ? `${currentPath}/${track.lrcPath}` : track.lrcPath;
    }
    Lyrics.load(`/api/lyrics/${encodeURIComponent(currentProjectId)}/${encodePath(lrcRelPath)}`);
  } else {
    Lyrics.current = [];
    Lyrics.render();
  }
}

// 播放器按钮
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

// 进度条
document.getElementById('progressBar').addEventListener('input', (e) => {
  Player.seek(e.target.value);
});

// 音量
document.getElementById('volumeBar').addEventListener('input', (e) => {
  Player.setVolume(e.target.value);
});

// 歌词弹窗
document.getElementById('lyricsToggleBtn').addEventListener('click', () => Lyrics.toggle());
document.getElementById('lyricsCloseBtn').addEventListener('click', () => Lyrics.toggle());
Lyrics.initDrag();
Lyrics.init();

// 图片预览弹窗
const imageOverlay = document.getElementById('imageOverlay');
const imagePreview = document.getElementById('imagePreview');
if (imageOverlay) {
  imageOverlay.addEventListener('click', (e) => {
    // 点击遮罩或关闭按钮都关闭
    if (e.target === imageOverlay || e.target.id === 'imageCloseBtn') {
      imageOverlay.classList.add('hidden');
      imagePreview.src = '';
    }
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && imageOverlay && !imageOverlay.classList.contains('hidden')) {
    imageOverlay.classList.add('hidden');
    imagePreview.src = '';
  }
});

// 预览图片（在浏览器内打开原图）
window.previewImage = function (relPath) {
  if (!imageOverlay || !imagePreview) return;
  const url = `/api/image/${encodeURIComponent(currentProjectId)}/${encodePath(relPath)}`;
  imagePreview.src = url;
  imageOverlay.classList.remove('hidden');
};

// 迷你播放器
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

// 刷新按钮
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

// 键盘快捷键
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      Player.togglePlay();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      Player.audio.currentTime = Math.max(0, (Player.audio.currentTime || 0) - 5);
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (Player.audio.duration) {
        Player.audio.currentTime = Math.min(Player.audio.duration, (Player.audio.currentTime || 0) + 5);
      }
      break;
  }
});

// 自动播放下一首时加载歌词
document.addEventListener('trackChanged', () => {
  loadLyricsForCurrent();
});

// 初始化
loadProjects();
