const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const mime = require('mime-types');
const sharp = require('sharp');
const NodeCache = require('node-cache');
const cors = require('cors');
const crypto = require('crypto');

// 内存缓存，TTL 5分钟
const memCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// 运行时配置（可由 startServer(options) 覆盖，路由内通过 getCfg() 读取）
const DEFAULT_MUSIC_ROOT = process.env.MUSIC_ROOT || 'F:\\新建文件夹\\新建文件夹\\Kikoeru';
const runtimeConfig = {
  PORT: parseInt(process.env.PORT) || 3000,
  MUSIC_ROOT: DEFAULT_MUSIC_ROOT,
  CACHE_FILE: path.join(__dirname, 'cache.json'),
  THUMBNAIL_DIR: path.join(__dirname, 'thumbnails')
};

function getCfg() { return runtimeConfig; }

const app = express();

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// 注意：MUSIC_ROOT / THUMBNAIL_DIR 在请求时通过 getCfg() 读取，便于运行时切换
app.use((req, res, next) => {
  res.locals.musicRoot = getCfg().MUSIC_ROOT;
  res.locals.thumbnailDir = getCfg().THUMBNAIL_DIR;
  next();
});
app.use('/music', (req, res, next) => {
  // 动态静态目录（express.static 在启动时绑定，这里用 inline middleware 重新映射）
  try {
    const rel = decodeURIComponent(req.path.replace(/^\//, ''));
    const p = path.join(getCfg().MUSIC_ROOT, rel);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return res.sendFile(p);
  } catch (e) { /* ignore */ }
  next();
});
app.use('/thumbnails', (req, res, next) => {
  try {
    const rel = decodeURIComponent(req.path.replace(/^\//, ''));
    const p = path.join(getCfg().THUMBNAIL_DIR, rel);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return res.sendFile(p);
  } catch (e) { /* ignore */ }
  next();
});

// ---------- 工具函数 ----------

// 音频扩展名
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aac', '.wma']);

// 图片扩展名
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);

// 歌词扩展名
const LYRICS_EXTS = new Set(['.lrc', '.vtt']);

// 自然排序
function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// MD5
function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

// 安全检查：防止路径遍历
function isSafePath(projectId, subPath) {
  const checkParts = (p) => {
    if (!p) return true;
    return p.split(/[\\/]/).every(part => part !== '..');
  };
  return checkParts(projectId) && checkParts(subPath);
}

// 获取项目下的子目录列表（用于主页卡片展示）
function getProjectSubdirs(projectDir) {
  if (!fs.existsSync(projectDir)) return [];
  try {
    return fs.readdirSync(projectDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch (e) {
    return [];
  }
}

// ---------- 扫描逻辑 ----------

// 扫描单个小项目的信息
async function scanSubProject(projectDir, dirName, parentName) {
  const illustDir = path.join(projectDir, '插图');
  const mainDir = path.join(projectDir, '正篇');
  const nameFile = path.join(projectDir, 'name.txt');

  // 读取中文名
  let chineseName = '';
  try {
    const nameContent = await fs.readFile(nameFile, 'utf-8');
    chineseName = nameContent.trim();
  } catch (e) {
    chineseName = '';
  }

  // 获取封面
  let coverPath = '';
  if (fs.existsSync(illustDir)) {
    const illustFiles = await fs.readdir(illustDir);
    const imgFiles = illustFiles.filter(f => {
      const ext = path.extname(f).toLowerCase();
      return IMAGE_EXTS.has(ext);
    });

    if (imgFiles.length > 0) {
      const fengmian = imgFiles.find(f => f.includes('封面'));
      if (fengmian) {
        coverPath = path.join(illustDir, fengmian);
      } else {
        let minArea = Infinity;
        for (const imgFile of imgFiles) {
          try {
            const fullPath = path.join(illustDir, imgFile);
            const metadata = await sharp(fullPath).metadata();
            const area = (metadata.width || 0) * (metadata.height || 0);
            if (area > 0 && area < minArea) {
              minArea = area;
              coverPath = fullPath;
            }
          } catch (e) { /* skip */ }
        }
        if (!coverPath) {
          coverPath = path.join(illustDir, imgFiles[0]);
        }
      }
    }
  }

  // 统计音频文件数
  let audioCount = 0;
  if (fs.existsSync(mainDir)) {
    audioCount = countAudioFiles(mainDir);
  }

  const subdirs = getProjectSubdirs(projectDir);

  // 查找 RJ 编号（项目目录下的文件或文件夹名匹配 RJ + 数字）
  let rjCode = '';
  try {
    const allEntries = await fs.readdir(projectDir);
    const rjMatch = allEntries.find(e => /^RJ\d+/i.test(e));
    if (rjMatch) {
      rjCode = rjMatch;
    }
  } catch (e) { /* ignore */ }

  // id 用相对路径，前端 encodeURIComponent 传递
  const id = parentName ? `${parentName}/${dirName}` : dirName;

  return {
    id,
    name: dirName,
    chineseName,
    rjCode,
    coverPath,
    audioCount,
    subdirs
  };
}

// 判断一个目录是否是"小项目"（包含正篇或音频文件）
function isProjectDir(dirPath) {
  try {
    // 有正篇目录就是项目
    if (fs.existsSync(path.join(dirPath, '正篇'))) return true;
    // 目录下直接有音频文件也是项目
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.some(e => e.isFile() && AUDIO_EXTS.has(path.extname(e.name).toLowerCase()));
  } catch (e) {
    return false;
  }
}

async function scanProjects() {
  const MUSIC_ROOT = getCfg().MUSIC_ROOT;
  if (!fs.existsSync(MUSIC_ROOT)) {
    return { projects: [], error: `音乐目录不存在: ${MUSIC_ROOT}` };
  }

  const entries = await fs.readdir(MUSIC_ROOT, { withFileTypes: true });
  const topDirs = entries
    .filter(e => e.isDirectory())
    .map(e => e.name);

  topDirs.sort(naturalSort);

  const projects = [];

  for (const topDir of topDirs) {
    const topDirPath = path.join(MUSIC_ROOT, topDir);

    // 判断 MUSIC_ROOT 下的目录是"大项目"还是"小项目"
    if (isProjectDir(topDirPath)) {
      // 直接就是小项目
      const project = await scanSubProject(topDirPath, topDir, '');
      projects.push(project);
    } else {
      // 是大项目，扫描其子目录
      const subEntries = await fs.readdir(topDirPath, { withFileTypes: true });
      const subDirs = subEntries
        .filter(e => e.isDirectory())
        .map(e => e.name);

      subDirs.sort(naturalSort);

      for (const subDir of subDirs) {
        const projectDir = path.join(topDirPath, subDir);
        const project = await scanSubProject(projectDir, subDir, topDir);
        projects.push(project);
      }
    }
  }

  return { projects, scannedAt: Date.now() };
}

function countAudioFiles(dir) {
  let count = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        count += countAudioFiles(path.join(dir, e.name));
      } else if (AUDIO_EXTS.has(path.extname(e.name).toLowerCase())) {
        count++;
      }
    }
  } catch (e) { /* ignore */ }
  return count;
}

// ---------- 浏览项目目录 ----------

function browseDir(dirPath, basePath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const dirs = [];
  const files = [];

  for (const e of entries) {
    if (e.isDirectory()) {
      dirs.push({ name: e.name, type: 'dir' });
    } else {
      const ext = path.extname(e.name).toLowerCase();
      const stat = fs.statSync(path.join(dirPath, e.name));
      const isAudio = AUDIO_EXTS.has(ext);
      const isLyrics = LYRICS_EXTS.has(ext);
      const isImage = IMAGE_EXTS.has(ext);

      // 查找对应的歌词文件（优先同名，其次 文件名+扩展名，最后目录内任意 lrc/vtt）
      let lrcPath = null;
      if (isAudio) {
        const baseName = e.name.replace(/\.[^.]+$/, '');
        // 1. 先找 baseName.lrc / baseName.vtt (如 tr00_xxx.vtt)
        for (const lrcExt of ['.lrc', '.vtt']) {
          const candidate = path.join(dirPath, baseName + lrcExt);
          if (fs.existsSync(candidate)) {
            lrcPath = baseName + lrcExt;
            break;
          }
        }
        // 2. 完整文件名+.lrc / .vtt (如 tr00_xxx.mp3.vtt)
        if (!lrcPath) {
          for (const lrcExt of ['.lrc', '.vtt']) {
            const candidate = path.join(dirPath, e.name + lrcExt);
            if (fs.existsSync(candidate)) {
              lrcPath = e.name + lrcExt;
              break;
            }
          }
        }
        // 3. 没找到则找目录内任意 .lrc / .vtt
        if (!lrcPath) {
          for (const otherFile of entries) {
            if (otherFile.isFile()) {
              const otherExt = path.extname(otherFile.name).toLowerCase();
              if (otherExt === '.lrc' || otherExt === '.vtt') {
                lrcPath = otherFile.name;
                break;
              }
            }
          }
        }
      }

      files.push({
        name: e.name,
        type: isAudio ? 'audio' : (isImage ? 'image' : (isLyrics ? 'lyrics' : 'file')),
        size: stat.size,
        lrcPath
      });
    }
  }

  dirs.sort((a, b) => naturalSort(a.name, b.name));
  files.sort((a, b) => naturalSort(a.name, b.name));

  return { dirs, files };
}

// ---------- 缓存管理 ----------

function getCachedProjects() {
  const cached = memCache.get('projects');
  if (cached) return cached;

  try {
    const CACHE_FILE = getCfg().CACHE_FILE;
    if (fs.existsSync(CACHE_FILE)) {
      const fileCache = fs.readJsonSync(CACHE_FILE);
      if (fileCache && fileCache.projects) {
        memCache.set('projects', fileCache);
        return fileCache;
      }
    }
  } catch (e) { /* ignore */ }

  return null;
}

function setCachedProjects(data) {
  memCache.set('projects', data);
  try {
    fs.writeJsonSync(getCfg().CACHE_FILE, data);
  } catch (e) { /* ignore */ }
}

// ---------- API 路由 ----------

// 获取所有项目
app.get('/api/projects', async (req, res) => {
  try {
    let data = getCachedProjects();
    if (!data) {
      data = await scanProjects();
      setCachedProjects(data);
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 浏览项目目录
app.get('/api/browse/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isSafePath(projectId)) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }

    const projectDir = path.join(getCfg().MUSIC_ROOT, projectId);
    if (!fs.existsSync(projectDir)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const result = browseDir(projectDir, '');
    // 返回项目名和中文名
    let chineseName = '';
    try {
      const nameFile = path.join(projectDir, 'name.txt');
      if (fs.existsSync(nameFile)) {
        chineseName = fs.readFileSync(nameFile, 'utf-8').trim();
      }
    } catch (e) { /* ignore */ }

    res.json({ ...result, projectId, name: projectId, chineseName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 浏览项目子目录
app.get('/api/browse/:projectId/*subpath', (req, res) => {
  try {
    const { projectId, subpath } = req.params;
    const subPath = Array.isArray(subpath) ? subpath.join('/') : (subpath || '');

    if (!isSafePath(projectId, subPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const fullPath = path.join(getCfg().MUSIC_ROOT, projectId, subPath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Directory not found' });
    }

    const result = browseDir(fullPath, subPath);
    res.json({ ...result, currentPath: subPath, projectId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 缩略图服务
app.get('/api/thumbnail', async (req, res) => {
  try {
    const { path: imgPath, size } = req.query;
    if (!imgPath) {
      return res.status(400).json({ error: 'Missing path parameter' });
    }

    const resolved = path.resolve(imgPath);
    const normalizedRoot = path.resolve(getCfg().MUSIC_ROOT);
    if (!resolved.startsWith(normalizedRoot)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const hash = md5(resolved);
    const s = parseInt(size) || 200;
    // 缩略图按 4:3 生成，与卡片展示比例一致，避免前端拉伸变形
    const sh = Math.round(s * 3 / 4);
    const thumbName = `${hash}_${s}x${sh}.jpg`;
    const THUMBNAIL_DIR = getCfg().THUMBNAIL_DIR;
    const thumbPath = path.join(THUMBNAIL_DIR, thumbName);

    if (fs.existsSync(thumbPath)) {
      return res.sendFile(thumbPath);
    }

    await fs.ensureDir(THUMBNAIL_DIR);
    await sharp(resolved)
      .resize(s, sh, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);

    res.sendFile(thumbPath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 原图服务（用于浏览器内图片预览，保留原始宽高比，不裁剪）
app.get('/api/image/:projectId/*subpath', (req, res) => {
  try {
    const { projectId, subpath } = req.params;
    const subPath = Array.isArray(subpath) ? subpath.join('/') : (subpath || '');

    if (!isSafePath(projectId, subPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const imgPath = path.join(getCfg().MUSIC_ROOT, projectId, subPath);

    if (!fs.existsSync(imgPath)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const mimeType = mime.lookup(imgPath);
    if (!mimeType || !mimeType.startsWith('image/')) {
      return res.status(400).json({ error: 'Not an image' });
    }

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(imgPath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 强制刷新缓存
app.get('/api/refresh', async (req, res) => {
  try {
    memCache.del('projects');
    const data = await scanProjects();
    setCachedProjects(data);
    res.json({ success: true, projectCount: data.projects.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 缓存大小查询
app.get('/api/cache/size', async (req, res) => {
  try {
    const THUMBNAIL_DIR = getCfg().THUMBNAIL_DIR;
    let totalBytes = 0;
    let fileCount = 0;
    if (fs.existsSync(THUMBNAIL_DIR)) {
      const files = await fs.readdir(THUMBNAIL_DIR);
      for (const f of files) {
        const stat = await fs.stat(path.join(THUMBNAIL_DIR, f));
        if (stat.isFile()) {
          totalBytes += stat.size;
          fileCount++;
        }
      }
    }
    res.json({ size: totalBytes, count: fileCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 清理缩略图缓存
app.post('/api/cache/clear', async (req, res) => {
  try {
    const THUMBNAIL_DIR = getCfg().THUMBNAIL_DIR;
    if (fs.existsSync(THUMBNAIL_DIR)) {
      const files = await fs.readdir(THUMBNAIL_DIR);
      for (const f of files) {
        await fs.remove(path.join(THUMBNAIL_DIR, f));
      }
    }
    // 同时清除项目扫描缓存
    memCache.del('projects');
    try { await fs.remove(getCfg().CACHE_FILE); } catch (e) { /* ignore */ }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取当前配置（前端设置页可读取展示）
app.get('/api/config', (req, res) => {
  const cfg = getCfg();
  res.json({
    musicRoot: cfg.MUSIC_ROOT,
    thumbnailDir: cfg.THUMBNAIL_DIR,
    port: cfg.PORT
  });
});

// 音频流服务（支持 Range 请求，支持子目录）
app.get('/api/audio/:projectId/*subpath', (req, res) => {
  try {
    const { projectId, subpath } = req.params;
    const subPath = Array.isArray(subpath) ? subpath.join('/') : (subpath || '');

    if (!isSafePath(projectId, subPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const audioPath = path.join(getCfg().MUSIC_ROOT, projectId, subPath);

    if (!fs.existsSync(audioPath)) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    const stat = fs.statSync(audioPath);
    const fileSize = stat.size;
    const mimeType = mime.lookup(audioPath) || 'audio/mpeg';

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType
      });

      fs.createReadStream(audioPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes'
      });

      fs.createReadStream(audioPath).pipe(res);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 歌词文件服务（LRC / VTT）
app.get('/api/lyrics/:projectId/*subpath', (req, res) => {
  try {
    const { projectId, subpath } = req.params;
    const subPath = Array.isArray(subpath) ? subpath.join('/') : (subpath || '');

    if (!isSafePath(projectId, subPath)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const lrcPath = path.join(getCfg().MUSIC_ROOT, projectId, subPath);

    if (!fs.existsSync(lrcPath)) {
      return res.status(404).json({ error: 'Lyrics file not found' });
    }

    res.sendFile(lrcPath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SPA 路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 旧版详情页路由重定向到主页
app.get('/detail/:id', (req, res) => {
  res.redirect('/');
});

// 启动服务器：可传入 { PORT, MUSIC_ROOT, THUMBNAIL_DIR, CACHE_FILE } 覆盖默认值
// 返回 http.Server 实例，便于 Electron 主进程关闭/重启
function startServer(options = {}) {
  if (options.MUSIC_ROOT) runtimeConfig.MUSIC_ROOT = options.MUSIC_ROOT;
  if (options.THUMBNAIL_DIR) runtimeConfig.THUMBNAIL_DIR = options.THUMBNAIL_DIR;
  if (options.CACHE_FILE) runtimeConfig.CACHE_FILE = options.CACHE_FILE;
  if (options.PORT) runtimeConfig.PORT = parseInt(options.PORT) || runtimeConfig.PORT;

  const PORT = runtimeConfig.PORT;
  return app.listen(PORT, () => {
    console.log(`音乐播放器已启动: http://localhost:${PORT}`);
    console.log(`音乐目录: ${runtimeConfig.MUSIC_ROOT}`);
    console.log(`缩略图缓存: ${runtimeConfig.THUMBNAIL_DIR}`);
  });
}

// 直接 node server.js 启动（保留命令行用法）
if (require.main === module) {
  startServer();
}

// 导出供 Electron 主进程调用
module.exports = { app, startServer, getCfg, runtimeConfig };