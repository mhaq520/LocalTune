const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const config = require('./lib/config');
const { startServer, clearProjectScanCache } = require('./server');

let mainWindow = null;
let settingsWindow = null;
let tray = null;
let serverInstance = null;
let serverStarted = false;
let serverStartupPromise = null;

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

function waitForServerListening(server) {
  return new Promise((resolve, reject) => {
    if (!server) {
      reject(new Error('Server instance missing'));
      return;
    }

    if (server.listening) {
      resolve(server);
      return;
    }

    const cleanup = () => {
      server.removeListener('listening', onListening);
      server.removeListener('error', onError);
    };

    const onListening = () => {
      cleanup();
      resolve(server);
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    server.once('listening', onListening);
    server.once('error', onError);
  });
}

function handleServerStartError(err, port) {
  if (err && err.code === 'EADDRINUSE') {
    dialog.showErrorBox('端口被占用', `端口 ${port} 已被占用，请在设置中修改端口后重启。`);
  } else {
    console.error('服务器错误', err);
  }
}

async function startEmbeddedServer() {
  if (serverInstance && serverStarted) return serverInstance;
  if (serverStartupPromise) return serverStartupPromise;

  const cfg = config.load();
  const musicRoot = cfg.musicRoot || '';

  serverInstance = startServer({
    PORT: cfg.port,
    MUSIC_ROOT: musicRoot,
    THUMBNAIL_DIR: cfg.thumbnailDir,
    CACHE_FILE: cfg.cacheFile
  });
  serverStarted = false;

  serverStartupPromise = waitForServerListening(serverInstance)
    .then(() => {
      serverStarted = true;
      return serverInstance;
    })
    .catch((err) => {
      serverStarted = false;
      serverInstance = null;
      handleServerStartError(err, cfg.port);
      throw err;
    })
    .finally(() => {
      serverStartupPromise = null;
    });

  return serverStartupPromise;
}

async function restartServer() {
  if (serverStartupPromise) {
    try {
      await serverStartupPromise;
    } catch (e) {
      // ignore startup failure here; the caller will observe the restart result
    }
  }

  if (serverInstance) {
    await new Promise((resolve) => {
      serverInstance.close(() => resolve());
    });
    serverInstance = null;
    serverStarted = false;
  }

  return startEmbeddedServer();
}

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

  const loadURL = async () => {
    try {
      await startEmbeddedServer();
      if (!mainWindow) return;
      const latestCfg = config.load();
      await mainWindow.loadURL(`http://localhost:${latestCfg.port}/`);
    } catch (err) {
      // startup error already surfaced
    }
  };

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  void loadURL();

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

function createTray() {
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

function updateAutoStart() {
  const cfg = config.load();
  app.setLoginItemSettings({
    openAtLogin: !!cfg.autoStart,
    args: ['--hidden']
  });
}

ipcMain.handle('dialog:openFolder', async (event) => {
  const parentWin = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(parentWin, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('config:load', () => {
  return config.load();
});

ipcMain.handle('config:save', (event, newCfg) => {
  return config.save(newCfg);
});

ipcMain.handle('server:restart', async () => {
  await restartServer();
  return { success: true };
});

ipcMain.handle('window:reloadMain', async () => {
  await startEmbeddedServer();
  if (mainWindow) {
    const cfg = config.load();
    await mainWindow.loadURL(`http://localhost:${cfg.port}/`);
  }
  return { success: true };
});

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

ipcMain.handle('cache:clear', async () => {
  const cfg = config.load();
  const dir = cfg.thumbnailDir;
  if (fs.existsSync(dir)) {
    const files = await fs.readdir(dir);
    for (const f of files) {
      await fs.remove(path.join(dir, f));
    }
  }

  clearProjectScanCache();
  try {
    await fs.remove(cfg.cacheFile);
  } catch (e) {
    // ignore
  }

  return { success: true };
});

ipcMain.handle('shell:openPath', async (event, p) => {
  if (p && fs.existsSync(p)) {
    shell.openPath(p);
  }
  return { success: true };
});

ipcMain.handle('settings:open', () => {
  createSettingsWindow();
  return { success: true };
});

if (!ensureSingleInstance()) {
  return;
}

app.whenReady().then(async () => {
  config.init(app.getPath('userData'));

  try {
    await startEmbeddedServer();
  } catch (e) {
    return;
  }

  createMainWindow();
  createTray();
  updateAutoStart();

  if (process.argv.includes('--hidden')) {
    if (mainWindow) mainWindow.hide();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    const cfg = config.load();
    if (!cfg.minimizeToTray) {
      app.isQuitting = true;
      app.quit();
    }
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverInstance) {
    serverInstance.close();
  }
});
