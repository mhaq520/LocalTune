// 设置页逻辑：通过 IPC 与主进程通信
// 注意：在 Electron 渲染进程中，window.electronAPI 由 preload 注入
// 这里使用 contextBridge 暴露的 API；若直接加载（非 Electron 环境），则回退到 HTTP

const hasIPC = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.invoke;
const api = hasIPC ? window.electronAPI : null;

// 包装 IPC 调用（带 fallback 到 HTTP）
async function callIPC(channel, ...args) {
  if (api) {
    return await api.invoke(channel, ...args);
  }
  // 非 Electron 环境的 HTTP 回退（仅查询类）
  if (channel === 'cache:size') {
    const r = await fetch('/api/cache/size');
    return await r.json();
  }
  if (channel === 'config:load') {
    const r = await fetch('/api/config');
    const j = await r.json();
    return { musicRoot: j.musicRoot, thumbnailDir: j.thumbnailDir, port: j.port };
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
  return bytes.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

async function loadConfig() {
  try {
    const cfg = await callIPC('config:load');
    if (cfg) {
      document.getElementById('musicRoot').value = cfg.musicRoot || '';
      document.getElementById('thumbnailDir').value = cfg.thumbnailDir || '';
      document.getElementById('port').value = cfg.port || 3000;
      document.getElementById('minimizeToTray').checked = !!cfg.minimizeToTray;
      document.getElementById('autoStart').checked = !!cfg.autoStart;
    }
  } catch (e) {
    showStatus('加载配置失败: ' + e.message, 'error');
  }
}

async function loadCacheInfo() {
  try {
    const info = await callIPC('cache:size');
    if (info) {
      document.getElementById('cacheSize').textContent = formatBytes(info.size);
      document.getElementById('cacheCount').textContent = info.count;
    }
  } catch (e) {
    /* ignore */
  }
}

function showStatus(msg, type) {
  const el = document.getElementById('saveStatus');
  el.textContent = msg;
  el.className = 'save-status ' + (type || '');
  if (msg) {
    setTimeout(() => { el.textContent = ''; el.className = 'save-status'; }, 3000);
  }
}

async function selectFolder(inputId) {
  if (!api) {
    alert('该功能仅在桌面应用中可用');
    return;
  }
  const result = await api.invoke('dialog:openFolder');
  if (result) {
    document.getElementById(inputId).value = result;
  }
}

async function saveSettings() {
  const cfg = {
    musicRoot: document.getElementById('musicRoot').value.trim(),
    thumbnailDir: document.getElementById('thumbnailDir').value.trim(),
    port: parseInt(document.getElementById('port').value) || 3000,
    minimizeToTray: document.getElementById('minimizeToTray').checked,
    autoStart: document.getElementById('autoStart').checked
  };

  if (!cfg.musicRoot) {
    showStatus('请先选择音乐目录', 'error');
    return;
  }

  try {
    if (api) {
      await api.invoke('config:save', cfg);
      showStatus('已保存，正在重启服务...', 'success');
      await api.invoke('server:restart');
      await api.invoke('window:reloadMain');
      showStatus('保存成功', 'success');
    } else {
      // HTTP 回退：调 /api/cache/clear 已无意义，这里只刷新
      const r = await fetch('/api/refresh');
      if (r.ok) showStatus('已刷新扫描缓存', 'success');
      else showStatus('保存失败', 'error');
    }
  } catch (e) {
    showStatus('保存失败: ' + e.message, 'error');
  }
}

async function clearCache() {
  if (!confirm('确定清理所有缩略图和扫描缓存吗？')) return;
  try {
    if (api) {
      await api.invoke('cache:clear');
    } else {
      await fetch('/api/cache/clear', { method: 'POST' });
    }
    await loadCacheInfo();
    showStatus('缓存已清理', 'success');
  } catch (e) {
    showStatus('清理失败: ' + e.message, 'error');
  }
}

async function openCacheDir() {
  const dir = document.getElementById('thumbnailDir').value.trim();
  if (!dir) {
    showStatus('未设置缓存目录', 'error');
    return;
  }
  if (api) {
    await api.invoke('shell:openPath', dir);
  } else {
    showStatus('仅桌面应用可打开目录', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  loadCacheInfo();

  document.getElementById('btnBrowseMusic').addEventListener('click', () => selectFolder('musicRoot'));
  document.getElementById('btnBrowseCache').addEventListener('click', () => selectFolder('thumbnailDir'));
  document.getElementById('btnClearCache').addEventListener('click', clearCache);
  document.getElementById('btnOpenCache').addEventListener('click', openCacheDir);
  document.getElementById('btnSave').addEventListener('click', saveSettings);
});
