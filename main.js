// Electron 主进程
// 职责：加载配置 → 启动 Express → 创建主窗口 / 设置窗口 / 系统托盘

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const config = require('./lib/config');

let mainWindow = null;
let settingsWindow = null;
let tray = null;
let serverInstance = null;
let serverStarted = false;

// 单实例锁（避免多开）
function ensureSingleInstance() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  return true;
}

// 启动内嵌 Express 服务器
async function startEmbeddedServer() {
  if (serverStarted) return;
  const cfg = config.load();
  // 首次启动且未配置音乐目录：用占位路径，让服务器跑起来以便加载设置页
  const musicRoot = cfg.musicRoot || '';
  const { startServer } = require('./server');
  serverInstance = startServer({
    PORT: cfg.port,
    MUSIC_ROOT: musicRoot,
    THUMBNAIL_DIR: cfg.thumbnailDir,
    CACHE_FILE: cfg.cacheFile
  });
  serverInstance.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      dialog.showErrorBox('端口被占用', `端口 ${cfg.port} 已被占用，请在设置中修改端口后重启。`);
    } else {
      console.error('服务器错误:', err);
    }
  });
  serverStarted = true;
}

async function restartServer() {
  if (serverInstance) {
    serverInstance.close(() => {
      serverStarted = false;
      startEmbeddedServer();
    });
  } else {
    startEmbeddedServer();
  }
}

// 创建主窗口
function createMainWindow() {
  const cfg = config.load();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#18181b',
    title: '音乐播放器',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false
  });

  // 等服务器就绪后加载页面
  const loadURL = () => {
    if (!serverStarted) {
      setTimeout(loadURL, 200);
      return;
    }
    mainWindow.loadURL(`http://localhost:${cfg.port}/`);
  };

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  loadURL();

  // 关闭窗口行为：最小化到托盘 or 退出
  mainWindow.on('close', (e) => {
    if (cfg.minimizeToTray && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 创建设置窗口
function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  const cfg = config.load();
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 640,
    resizable: false,
    title: '设置',
    parent: mainWindow || undefined,
    modal: false,
    backgroundColor: '#18181b',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  settingsWindow.loadURL(`http://localhost:${cfg.port}/settings.html`);
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// 系统托盘
function createTray() {
  // 用 1x1 透明 png 作为托盘图标占位（无图标资源时 fallback）
  let icon = nativeImage.createEmpty();
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  }
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { if (mainWindow) mainWindow.show(); } },
    { label: '设置', click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('音乐播放器');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) mainWindow.hide();
      else mainWindow.show();
    }
  });
}

// 开机自启
function updateAutoStart() {
  const cfg = config.load();
  app.setLoginItemSettings({
    openAtLogin: !!cfg.autoStart,
    args: ['--hidden']
  });
}

// IPC：选择文件夹
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// IPC：读取配置
ipcMain.handle('config:load', () => {
  return config.load();
});

// IPC：保存配置
ipcMain.handle('config:save', (event, newCfg) => {
  const saved = config.save(newCfg);
  return saved;
});

// IPC：重启服务器（保存配置后调用）
ipcMain.handle('server:restart', async () => {
  await restartServer();
  return { success: true };
});

// IPC：刷新主窗口（配置变更后）
ipcMain.handle('window:reloadMain', () => {
  if (mainWindow) {
    const cfg = config.load();
    mainWindow.loadURL(`http://localhost:${cfg.port}/`);
  }
  return { success: true };
});

// IPC：获取缓存大小（直接调 fs，不走 HTTP）
ipcMain.handle('cache:size', async () => {
  const cfg = config.load();
  const dir = cfg.thumbnailDir;
  if (!fs.existsSync(dir)) return { size: 0, count: 0 };
  let totalBytes = 0;
  let fileCount = 0;
  const files = await fs.readdir(dir);
  for (const f of files) {
    const stat = await fs.stat(path.join(dir, f));
    if (stat.isFile()) {
      totalBytes += stat.size;
      fileCount++;
    }
  }
  return { size: totalBytes, count: fileCount };
});

// IPC：清理缓存
ipcMain.handle('cache:clear', async () => {
  const cfg = config.load();
  const dir = cfg.thumbnailDir;
  if (fs.existsSync(dir)) {
    const files = await fs.readdir(dir);
    for (const f of files) {
      await fs.remove(path.join(dir, f));
    }
  }
  try { await fs.remove(cfg.cacheFile); } catch (e) { /* ignore */ }
  return { success: true };
});

// IPC：打开外部链接（如打开缓存目录）
ipcMain.handle('shell:openPath', async (event, p) => {
  if (p && fs.existsSync(p)) {
    shell.openPath(p);
  }
  return { success: true };
});

// App 生命周期
if (!ensureSingleInstance()) {
  return;
}

app.whenReady().then(async () => {
  // 初始化配置文件路径
  config.init(app.getPath('userData'));

  // 启动服务器
  await startEmbeddedServer();

  // 创建窗口 + 托盘
  createMainWindow();
  createTray();
  updateAutoStart();

  // 命令行 --hidden 则启动后隐藏主窗口
  if (process.argv.includes('--hidden')) {
    if (mainWindow) mainWindow.hide();
  }

  // macOS 点击 dock 图标时重建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// 所有窗口关闭时退出（macOS 除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 启用托盘时不退出，否则退出
    const cfg = config.load();
    if (!cfg.minimizeToTray) {
      app.isQuitting = true;
      app.quit();
    }
  }
});

// 退出前关闭服务器
app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverInstance) {
    serverInstance.close();
  }
});
