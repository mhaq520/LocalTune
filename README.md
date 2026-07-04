# 音乐播放器 (Music Player)

基于 Node.js + Express 的本地音乐播放器。

## 功能特性

- 目录扫描：自动扫描音乐目录，支持两级目录结构（大项目/小项目）
- 音频播放：支持 MP3、FLAC、WAV、M4A、OGG，支持 Range 请求（拖拽进度条）
- 歌词同步：支持 LRC 和 VTT 格式，自动匹配，高亮当前行
- 缩略图生成：使用 sharp 自动生成封面缩略图并缓存
- 面包屑导航：项目内文件夹自由浏览，自动跳转「正篇」目录
- 迷你播放器：可折叠为悬浮迷你模式
- 键盘快捷键：空格暂停/播放，左右键快进快退
- 单页应用：返回主页时音乐继续播放

## 技术栈

| 类别 | 依赖 |
|------|------|
| Web 框架 | express |
| 文件操作 | fs-extra |
| 图片处理 | sharp |
| MIME 检测 | mime-types |
| 内存缓存 | node-cache |
| 跨域 | cors |
| 热重载（开发） | nodemon |

## 快速开始

### 1. 安装依赖

```bash
cd music-player
npm install
```

### 2. 配置音乐目录

编辑 server.js 第 12 行：

```javascript
const MUSIC_ROOT = 'F:\\你的\\音乐\\目录';
```

或通过环境变量：

```powershell
$env:MUSIC_PATH="D:\你的音乐目录"
npm start
```

### 3. 启动

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm start
```

访问 http://localhost:3000

### 4. 自定义端口

```powershell
$env:PORT="8080"
npm start
```

## 目录结构要求

### 布局一：直接是小项目

```
MUSIC_ROOT/
├── 项目A/
│   ├── 正篇/
│   │   ├── track1.mp3
│   │   ├── track1.lrc        # 歌词（可选）
│   │   └── track2.mp3
│   ├── 插图/
│   │   └── 封面.png
│   └── name.txt              # 中文名（可选）
└── 项目B/
```

### 布局二：大项目包含小项目

```
MUSIC_ROOT/
├── 大项目1/
│   ├── 小项目A/
│   │   ├── 正篇/
│   │   ├── 插图/
│   │   └── name.txt
│   └── 小项目B/
└── 大项目2/
```

主页只显示小项目，大项目层级被跳过。

### RJ 编号识别

项目文件夹内若存在以 RJ 开头加数字的文件或文件夹（如 RJ458561），主页卡片优先显示该编号。

### 封面识别优先级

1. 文件名包含「封面」的图片
2. 没有则遍历所有图片，选择面积最小的

### 歌词匹配优先级

1. 同名文件：track1.mp3 -> track1.lrc / track1.vtt
2. 完整文件名+扩展名：track1.mp3 -> track1.mp3.vtt
3. 目录内任意 .lrc / .vtt 文件

## API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | / | 主页面（SPA） |
| GET | /api/projects | 获取所有项目列表 |
| GET | /api/browse/:projectId | 浏览项目根目录 |
| GET | /api/browse/:projectId/:subpath | 浏览项目子目录 |
| GET | /api/audio/:projectId/:subpath | 音频流（支持 Range） |
| GET | /api/lyrics/:projectId/:subpath | 歌词文件 |
| GET | /api/thumbnail?path=&size= | 缩略图（自动生成缓存） |
| GET | /api/refresh | 强制重新扫描 |

## 键盘快捷键

| 按键 | 功能 |
|------|------|
| 空格 | 播放/暂停 |
| 左箭头 | 后退 5 秒 |
| 右箭头 | 前进 5 秒 |

## 缓存

- 内存缓存（node-cache）：项目列表，TTL 5 分钟
- 文件缓存（cache.json）：持久化扫描结果，重启时自动加载
- 缩略图缓存（thumbnails/）：首次访问生成，后续直接返回

点击主页右上角「刷新」按钮可强制重新扫描。

## 项目结构

```
music-player/
├── server.js              # 主服务器
├── package.json
├── .gitignore
├── README.md              # 本文档
├── public/                # 静态前端
│   ├── index.html         # SPA 主页面
│   ├── css/
│   │   ├── main.css       # 网格视图样式
│   │   └── detail.css     # 详情页 + 播放器样式
│   ├── js/
│   │   ├── app.js         # 主逻辑
│   │   ├── player.js      # 播放器核心
│   │   └── lyrics.js      # 歌词解析与同步
│   └── assets/
│       └── default-cover.png
├── thumbnails/            # 缩略图缓存（git忽略）
└── cache.json             # 数据缓存（git忽略）
```

## 生产部署

### PM2 守护进程

```bash
npm install -g pm2
pm2 start server.js --name music-player
pm2 save
pm2 startup
```

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| MUSIC_PATH | ~/Music | 音乐根目录 |
| PORT | 3000 | 服务端口 |

## 许可证

MIT
