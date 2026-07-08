// 配置管理器：在 Electron 的 userData 目录下读写 config.json
// userData 路径示例: C:\Users\<user>\AppData\Roaming\music-player\config.json

const fs = require('fs-extra');
const path = require('path');

let userDataPath = null;
let configFilePath = null;

const DEFAULTS = {
  musicRoot: '',          // 用户首次启动时若为空，则引导到设置页选择
  thumbnailDir: '',       // 为空时使用 userData/thumbnails
  port: 3000,
  minimizeToTray: true,
  autoStart: false
};

function init(userDataDir) {
  userDataPath = userDataDir;
  configFilePath = path.join(userDataPath, 'config.json');
}

function _resolvePaths(cfg) {
  // 填充默认目录
  if (!cfg.thumbnailDir) {
    cfg.thumbnailDir = path.join(userDataPath, 'thumbnails');
  }
  if (!cfg.cacheFile) {
    cfg.cacheFile = path.join(userDataPath, 'cache.json');
  }
  return cfg;
}

function load() {
  if (!configFilePath) {
    throw new Error('config 模块未初始化，请先调用 init(userDataDir)');
  }
  let cfg;
  try {
    if (fs.existsSync(configFilePath)) {
      cfg = fs.readJsonSync(configFilePath);
    } else {
      cfg = {};
    }
  } catch (e) {
    cfg = {};
  }
  // 合并默认值
  cfg = { ...DEFAULTS, ...cfg };
  _resolvePaths(cfg);
  return cfg;
}

function save(cfg) {
  if (!configFilePath) {
    throw new Error('config 模块未初始化');
  }
  const merged = { ...DEFAULTS, ...cfg };
  _resolvePaths(merged);
  // 只保存用户可配置的字段（避免保存计算出来的路径）
  const toSave = {
    musicRoot: merged.musicRoot || '',
    thumbnailDir: merged.thumbnailDir || '',
    port: parseInt(merged.port) || 3000,
    minimizeToTray: !!merged.minimizeToTray,
    autoStart: !!merged.autoStart
  };
  fs.writeJsonSync(configFilePath, toSave, { spaces: 2 });
  return merged;
}

function getConfigPath() {
  return configFilePath;
}

module.exports = { init, load, save, getConfigPath, DEFAULTS };
