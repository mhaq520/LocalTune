const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const mime = require('mime-types');
const sharp = require('sharp');
const NodeCache = require('node-cache');
const cors = require('cors');
const crypto = require('crypto');

const memCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

const DEFAULT_MUSIC_ROOT = process.env.MUSIC_ROOT || '';
const WEB_CONFIG_FILE = path.join(__dirname, 'web-config.json');
const runtimeConfig = {
  PORT: parseInt(process.env.PORT, 10) || 8080,
  MUSIC_ROOT: DEFAULT_MUSIC_ROOT,
  CACHE_FILE: path.join(__dirname, 'cache.json'),
  THUMBNAIL_DIR: path.join(__dirname, 'thumbnails')
};

function loadWebConfig() {
  try {
    if (fs.existsSync(WEB_CONFIG_FILE)) {
      const c = fs.readJsonSync(WEB_CONFIG_FILE);
      if (c.musicRoot) runtimeConfig.MUSIC_ROOT = c.musicRoot;
      if (c.thumbnailDir) runtimeConfig.THUMBNAIL_DIR = c.thumbnailDir;
      if (c.cacheFile) runtimeConfig.CACHE_FILE = c.cacheFile;
    }
  } catch (e) {
    // ignore
  }
}
loadWebConfig();

function getCfg() {
  return runtimeConfig;
}

function resolvePathWithinRoot(root, ...segments) {
  if (!root) return null;
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, ...segments);
  const relative = path.relative(normalizedRoot, resolved);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolved;
  }
  return null;
}

function normalizeRequestPath(requestPath) {
  if (!requestPath) return '';
  try {
    return decodeURIComponent(requestPath).replace(/^[/\\]+/, '');
  } catch (e) {
    return null;
  }
}

function sendResolvedFile(res, root, requestPath, next) {
  const normalized = normalizeRequestPath(requestPath);
  if (normalized === null) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  try {
    const resolved = resolvePathWithinRoot(root, normalized);
    if (!resolved) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return res.sendFile(resolved);
    }
  } catch (e) {
    // ignore
  }

  return next();
}

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.locals.musicRoot = getCfg().MUSIC_ROOT;
  res.locals.thumbnailDir = getCfg().THUMBNAIL_DIR;
  next();
});
app.use('/music', (req, res, next) => {
  const root = getCfg().MUSIC_ROOT;
  if (!root) return next();
  return sendResolvedFile(res, root, req.path, next);
});
app.use('/thumbnails', (req, res, next) => {
  return sendResolvedFile(res, getCfg().THUMBNAIL_DIR, req.path, next);
});

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aac', '.wma']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);
const LYRICS_EXTS = new Set(['.lrc', '.vtt']);

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function getProjectSubdirs(projectDir) {
  if (!fs.existsSync(projectDir)) return [];
  try {
    return fs.readdirSync(projectDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (e) {
    return [];
  }
}

async function scanSubProject(projectDir, dirName, parentName) {
  const illustDir = path.join(projectDir, '插图');
  const mainDir = path.join(projectDir, '正篇');
  const nameFile = path.join(projectDir, 'name.txt');

  let chineseName = '';
  try {
    const nameContent = await fs.readFile(nameFile, 'utf-8');
    chineseName = nameContent.trim();
  } catch (e) {
    chineseName = '';
  }

  let coverPath = '';
  if (fs.existsSync(illustDir)) {
    const illustFiles = await fs.readdir(illustDir);
    const imgFiles = illustFiles.filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()));

    if (imgFiles.length > 0) {
      const fengmian = imgFiles.find((f) => f.includes('封面'));
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
          } catch (e) {
            // skip unreadable image
          }
        }
        if (!coverPath) {
          coverPath = path.join(illustDir, imgFiles[0]);
        }
      }
    }
  }

  let audioCount = 0;
  if (fs.existsSync(mainDir)) {
    audioCount = countAudioFiles(mainDir);
  }

  const subdirs = getProjectSubdirs(projectDir);

  let rjCode = '';
  try {
    const allEntries = await fs.readdir(projectDir);
    const rjMatch = allEntries.find((e) => /^RJ\d+/i.test(e));
    if (rjMatch) {
      rjCode = rjMatch;
    }
  } catch (e) {
    // ignore
  }

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

function isProjectDir(dirPath) {
  try {
    if (fs.existsSync(path.join(dirPath, '正篇'))) return true;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.some((e) => e.isFile() && AUDIO_EXTS.has(path.extname(e.name).toLowerCase()));
  } catch (e) {
    return false;
  }
}

async function scanProjects() {
  const MUSIC_ROOT = getCfg().MUSIC_ROOT;
  if (!MUSIC_ROOT) {
    return { projects: [], error: '请先在设置中选择音乐目录' };
  }
  if (!fs.existsSync(MUSIC_ROOT)) {
    return { projects: [], error: `音乐目录不存在: ${MUSIC_ROOT}` };
  }

  const entries = await fs.readdir(MUSIC_ROOT, { withFileTypes: true });
  const topDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  topDirs.sort(naturalSort);

  const projects = [];

  for (const topDir of topDirs) {
    const topDirPath = path.join(MUSIC_ROOT, topDir);
    if (isProjectDir(topDirPath)) {
      const project = await scanSubProject(topDirPath, topDir, '');
      projects.push(project);
    } else {
      const subEntries = await fs.readdir(topDirPath, { withFileTypes: true });
      const subDirs = subEntries.filter((e) => e.isDirectory()).map((e) => e.name);
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
  } catch (e) {
    // ignore
  }
  return count;
}

function browseDir(dirPath, basePath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const dirs = [];
  const files = [];

  for (const e of entries) {
    if (e.isDirectory()) {
      dirs.push({ name: e.name, type: 'dir' });
      continue;
    }

    const ext = path.extname(e.name).toLowerCase();
    const stat = fs.statSync(path.join(dirPath, e.name));
    const isAudio = AUDIO_EXTS.has(ext);
    const isLyrics = LYRICS_EXTS.has(ext);
    const isImage = IMAGE_EXTS.has(ext);

    let lrcPath = null;
    if (isAudio) {
      const baseName = e.name.replace(/\.[^.]+$/, '');
      for (const lrcExt of ['.lrc', '.vtt']) {
        const candidate = path.join(dirPath, baseName + lrcExt);
        if (fs.existsSync(candidate)) {
          lrcPath = baseName + lrcExt;
          break;
        }
      }
      if (!lrcPath) {
        for (const lrcExt of ['.lrc', '.vtt']) {
          const candidate = path.join(dirPath, e.name + lrcExt);
          if (fs.existsSync(candidate)) {
            lrcPath = e.name + lrcExt;
            break;
          }
        }
      }
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

  dirs.sort((a, b) => naturalSort(a.name, b.name));
  files.sort((a, b) => naturalSort(a.name, b.name));

  return { dirs, files };
}

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
  } catch (e) {
    // ignore
  }

  return null;
}

function setCachedProjects(data) {
  memCache.set('projects', data);
  try {
    fs.writeJsonSync(getCfg().CACHE_FILE, data);
  } catch (e) {
    // ignore
  }
}

function clearProjectScanCache() {
  memCache.del('projects');
}

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

app.get('/api/browse/:projectId', (req, res) => {
  try {
    if (!getCfg().MUSIC_ROOT) {
      return res.status(400).json({ error: '请先在设置中选择音乐目录' });
    }

    const { projectId } = req.params;
    const projectDir = resolvePathWithinRoot(getCfg().MUSIC_ROOT, projectId);
    if (!projectDir) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }

    if (!fs.existsSync(projectDir)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const result = browseDir(projectDir, '');
    let chineseName = '';
    try {
      const nameFile = path.join(projectDir, 'name.txt');
      if (fs.existsSync(nameFile)) {
        chineseName = fs.readFileSync(nameFile, 'utf-8').trim();
      }
    } catch (e) {
      // ignore
    }

    res.json({ ...result, projectId, name: projectId, chineseName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/browse/:projectId/*subpath', (req, res) => {
  try {
    if (!getCfg().MUSIC_ROOT) {
      return res.status(400).json({ error: '请先在设置中选择音乐目录' });
    }

    const { projectId, subpath } = req.params;
    const subPath = Array.isArray(subpath) ? subpath.join('/') : (subpath || '');
    const fullPath = resolvePathWithinRoot(getCfg().MUSIC_ROOT, projectId, subPath);
    if (!fullPath) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Directory not found' });
    }

    const result = browseDir(fullPath, subPath);
    res.json({ ...result, currentPath: subPath, projectId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/thumbnail', async (req, res) => {
  try {
    if (!getCfg().MUSIC_ROOT) {
      return res.status(400).json({ error: '请先在设置中选择音乐目录' });
    }

    const { path: imgPath, size } = req.query;
    if (!imgPath) {
      return res.status(400).json({ error: 'Missing path parameter' });
    }

    const resolved = resolvePathWithinRoot(path.resolve(getCfg().MUSIC_ROOT), normalizeRequestPath(imgPath));
    if (!resolved) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const hash = md5(resolved);
    const s = parseInt(size, 10) || 200;
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

app.get('/api/image/:projectId/*subpath', (req, res) => {
  try {
    if (!getCfg().MUSIC_ROOT) {
      return res.status(400).json({ error: '请先在设置中选择音乐目录' });
    }

    const { projectId, subpath } = req.params;
    const subPath = Array.isArray(subpath) ? subpath.join('/') : (subpath || '');
    const imgPath = resolvePathWithinRoot(getCfg().MUSIC_ROOT, projectId, subPath);
    if (!imgPath) {
      return res.status(400).json({ error: 'Invalid path' });
    }

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

app.get('/api/refresh', async (req, res) => {
  try {
    clearProjectScanCache();
    const data = await scanProjects();
    setCachedProjects(data);
    res.json({ success: true, projectCount: data.projects.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

app.post('/api/cache/clear', async (req, res) => {
  try {
    const THUMBNAIL_DIR = getCfg().THUMBNAIL_DIR;
    if (fs.existsSync(THUMBNAIL_DIR)) {
      const files = await fs.readdir(THUMBNAIL_DIR);
      for (const f of files) {
        await fs.remove(path.join(THUMBNAIL_DIR, f));
      }
    }
    clearProjectScanCache();
    try {
      await fs.remove(getCfg().CACHE_FILE);
    } catch (e) {
      // ignore
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config', (req, res) => {
  const cfg = getCfg();
  res.json({
    musicRoot: cfg.MUSIC_ROOT,
    thumbnailDir: cfg.THUMBNAIL_DIR,
    port: cfg.PORT
  });
});

app.post('/api/config', (req, res) => {
  try {
    const { musicRoot, thumbnailDir, port } = req.body || {};
    const toSave = {
      musicRoot: (musicRoot || '').trim(),
      thumbnailDir: (thumbnailDir || '').trim(),
      port: parseInt(port, 10) || runtimeConfig.PORT
    };

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'musicRoot')) {
      runtimeConfig.MUSIC_ROOT = toSave.musicRoot;
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'thumbnailDir')) {
      runtimeConfig.THUMBNAIL_DIR = toSave.thumbnailDir;
    }

    fs.writeJsonSync(WEB_CONFIG_FILE, toSave, { spaces: 2 });
    clearProjectScanCache();
    try {
      fs.removeSync(getCfg().CACHE_FILE);
    } catch (e) {
      // ignore
    }

    res.json({
      success: true,
      portChanged: toSave.port !== runtimeConfig.PORT,
      needRestart: toSave.port !== runtimeConfig.PORT
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/audio/:projectId/*subpath', (req, res) => {
  try {
    if (!getCfg().MUSIC_ROOT) {
      return res.status(400).json({ error: '请先在设置中选择音乐目录' });
    }

    const { projectId, subpath } = req.params;
    const subPath = Array.isArray(subpath) ? subpath.join('/') : (subpath || '');
    const audioPath = resolvePathWithinRoot(getCfg().MUSIC_ROOT, projectId, subPath);
    if (!audioPath) {
      return res.status(400).json({ error: 'Invalid path' });
    }

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

app.get('/api/lyrics/:projectId/*subpath', (req, res) => {
  try {
    if (!getCfg().MUSIC_ROOT) {
      return res.status(400).json({ error: '请先在设置中选择音乐目录' });
    }

    const { projectId, subpath } = req.params;
    const subPath = Array.isArray(subpath) ? subpath.join('/') : (subpath || '');
    const lrcPath = resolvePathWithinRoot(getCfg().MUSIC_ROOT, projectId, subPath);
    if (!lrcPath) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    if (!fs.existsSync(lrcPath)) {
      return res.status(404).json({ error: 'Lyrics file not found' });
    }

    res.sendFile(lrcPath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/detail/:id', (req, res) => {
  res.redirect('/');
});

function startServer(options = {}) {
  if ('MUSIC_ROOT' in options) runtimeConfig.MUSIC_ROOT = options.MUSIC_ROOT;
  if ('THUMBNAIL_DIR' in options) runtimeConfig.THUMBNAIL_DIR = options.THUMBNAIL_DIR;
  if ('CACHE_FILE' in options) runtimeConfig.CACHE_FILE = options.CACHE_FILE;
  if ('PORT' in options) runtimeConfig.PORT = parseInt(options.PORT, 10) || runtimeConfig.PORT;

  const PORT = runtimeConfig.PORT;
  const server = app.listen(PORT);

  server.once('listening', () => {
    console.log(`音乐播放器已启动: http://localhost:${PORT}`);
    console.log(`音乐目录: ${runtimeConfig.MUSIC_ROOT}`);
    console.log(`缩略图缓存: ${runtimeConfig.THUMBNAIL_DIR}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EACCES') {
      console.error(`\n[错误] 无法监听端口 ${PORT}: 权限被拒绝。`);
      console.error('请使用未被保留的端口启动。');
    } else if (err.code === 'EADDRINUSE') {
      console.error(`\n[错误] 端口 ${PORT} 已被占用，请使用其他端口。`);
    } else {
      console.error(`\n[错误] 服务器启动失败:`, err.message);
    }

    if (require.main === module) {
      process.exit(1);
    }
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
  getCfg,
  runtimeConfig,
  clearProjectScanCache,
  resolvePathWithinRoot
};
