const hasIPC = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.invoke;
const api = hasIPC ? window.electronAPI : null;

let saveInFlight = false;
let cacheClearInFlight = false;
let statusTimer = null;

async function callIPC(channel, ...args) {
  if (api) {
    return await api.invoke(channel, ...args);
  }

  if (channel === 'cache:size') {
    const r = await fetch('/api/cache/size');
    return await r.json();
  }

  if (channel === 'config:load') {
    const r = await fetch('/api/config');
    const j = await r.json();
    return {
      musicRoot: j.musicRoot,
      thumbnailDir: j.thumbnailDir,
      port: j.port,
      minimizeToTray: j.minimizeToTray,
      autoStart: j.autoStart
    };
  }

  return null;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function loadConfig() {
  try {
    const cfg = await callIPC('config:load');
    if (!cfg) return;

    document.getElementById('musicRoot').value = cfg.musicRoot || '';
    document.getElementById('thumbnailDir').value = cfg.thumbnailDir || '';
    document.getElementById('port').value = cfg.port || 8080;
    document.getElementById('minimizeToTray').checked = !!cfg.minimizeToTray;
    document.getElementById('autoStart').checked = !!cfg.autoStart;
  } catch (e) {
    showStatus('加载配置失败: ' + e.message, 'error');
  }
}

async function loadCacheInfo() {
  try {
    const info = await callIPC('cache:size');
    if (!info) return;

    document.getElementById('cacheSize').textContent = formatBytes(info.size);
    document.getElementById('cacheCount').textContent = info.count;
  } catch (_) {
    /* ignore */
  }
}

function showStatus(msg, type) {
  const el = document.getElementById('saveStatus');
  if (!el) return;

  el.textContent = msg;
  el.className = 'save-status ' + (type || '');

  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }

  if (msg) {
    statusTimer = setTimeout(() => {
      el.textContent = '';
      el.className = 'save-status';
      statusTimer = null;
    }, 3000);
  }
}

async function selectFolder(inputId) {
  if (!api) {
    alert('该功能仅在桌面应用中可用');
    return;
  }

  try {
    const result = await api.invoke('dialog:openFolder');
    if (result) {
      document.getElementById(inputId).value = result;
    }
  } catch (e) {
    showStatus('打开文件夹选择器失败: ' + e.message, 'error');
  }
}

async function saveSettings() {
  if (saveInFlight) return;
  saveInFlight = true;

  const saveBtn = document.getElementById('btnSave');
  if (saveBtn) saveBtn.disabled = true;

  const cfg = {
    musicRoot: document.getElementById('musicRoot').value.trim(),
    thumbnailDir: document.getElementById('thumbnailDir').value.trim(),
    port: parseInt(document.getElementById('port').value, 10) || 8080,
    minimizeToTray: document.getElementById('minimizeToTray').checked,
    autoStart: document.getElementById('autoStart').checked
  };

  if (!cfg.musicRoot) {
    showStatus('请先选择音乐目录', 'error');
    saveInFlight = false;
    if (saveBtn) saveBtn.disabled = false;
    return;
  }

  try {
    if (api) {
      const saved = await api.invoke('config:save', cfg);
      showStatus('已保存，正在重载主界面...', 'success');
      await api.invoke('server:restart');
      await api.invoke('window:reloadMain');
      if (saved && saved.port) {
        const nextUrl = `http://localhost:${saved.port}/settings.html`;
        if (window.location.href !== nextUrl) {
          window.location.replace(nextUrl);
          return;
        }
      }
    } else {
      const r = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg)
      });
      const j = await r.json();

      if (!r.ok || !j.success) {
        throw new Error(j.error || '保存失败');
      }

      if (j.needRestart) {
        showStatus('已保存，端口修改需要重启服务生效', 'success');
      } else {
        showStatus('保存成功，已切换目录', 'success');
      }
    }
  } catch (e) {
    showStatus('保存失败: ' + e.message, 'error');
  } finally {
    saveInFlight = false;
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function clearCache() {
  if (cacheClearInFlight) return;
  if (!confirm('确定清理所有缩略图和扫描缓存吗？')) return;

  cacheClearInFlight = true;
  const clearBtn = document.getElementById('btnClearCache');
  if (clearBtn) clearBtn.disabled = true;

  try {
    if (api) {
      await api.invoke('cache:clear');
    } else {
      const r = await fetch('/api/cache/clear', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.success === false) {
        throw new Error(j.error || '清理失败');
      }
    }

    await loadCacheInfo();
    showStatus('缓存已清理', 'success');
  } catch (e) {
    showStatus('清理失败: ' + e.message, 'error');
  } finally {
    cacheClearInFlight = false;
    if (clearBtn) clearBtn.disabled = false;
  }
}

async function openCacheDir() {
  const dir = document.getElementById('thumbnailDir').value.trim();
  if (!dir) {
    showStatus('未设置缓存目录', 'error');
    return;
  }

  try {
    if (api) {
      await api.invoke('shell:openPath', dir);
    } else {
      showStatus('仅桌面应用可打开目录', 'error');
    }
  } catch (e) {
    showStatus('打开缓存目录失败: ' + e.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  loadCacheInfo();

  if (!api) {
    const m = document.getElementById('musicRoot');
    const t = document.getElementById('thumbnailDir');
    m.removeAttribute('readonly');
    t.removeAttribute('readonly');
    m.placeholder = '请输入音乐根目录的绝对路径';
    t.placeholder = '请输入缓存目录的绝对路径（留空使用默认）';
  }

  document.getElementById('btnBrowseMusic').addEventListener('click', () => selectFolder('musicRoot'));
  document.getElementById('btnBrowseCache').addEventListener('click', () => selectFolder('thumbnailDir'));
  document.getElementById('btnClearCache').addEventListener('click', clearCache);
  document.getElementById('btnOpenCache').addEventListener('click', openCacheDir);
  document.getElementById('btnSave').addEventListener('click', saveSettings);
});
