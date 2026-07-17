# 音乐播放器 (Music Player)

基于 Node.js + Express 的本地音乐播放器，支持以 **Electron 桌面应用** 形式独立窗口运行，也可作为纯 Web 服务启动。

## 功能特性

- 桌面应用：Electron 独立窗口运行，系统托盘常驻，支持开机自启、最小化到托盘、单实例锁
- 设置入口：主页右上角齿轮图标，Electron 下打开独立设置窗口，Web 下跳转设置页
- 设置面板：图形化配置音乐目录 / 缓存目录 / 服务端口 / 行为开关，一键清理缓存，配置持久化
- 空目录引导：首次启动不预置目录，所有数据接口在未配置时返回友好提示，引导用户进入设置
- 目录扫描：自动扫描音乐目录，支持两级目录结构（大项目/小项目）
- 音频播放：支持 MP3、FLAC、WAV、M4A、OGG，支持 Range 请求（拖拽进度条）
- 歌词同步：支持 LRC 和 VTT 格式，自动匹配，高亮当前行
- 歌词点击跳转：点击任意歌词行即可跳转音频到对应时间戳
- 歌词自动回位：用户手动滚动浏览歌词 5 秒后，自动滚动回当前播放位置
- 图片预览：点击项目内图片文件，浏览器内弹窗查看原图（Esc / 点遮罩关闭）
- 缩略图生成：使用 sharp 自动生成 4:3 封面缩略图并缓存（与卡片比例一致，无变形）
- 卡片视觉：4:3 封面、RJ 编号悬浮封面左上角、中文名纯黑显示、白底卡片、3 行省略高度统一
- 极简暗色 UI：CSS 变量统一管理配色（`#18181b` / `#27272a` / `#fafafa`），Header / 播放栏 / 弹窗采用毛玻璃 backdrop-filter，统一 cubic-bezier 过渡与细滚动条
- 面包屑导航：项目内文件夹自由浏览，自动跳转「正篇」目录
- 迷你播放器：可折叠为悬浮迷你模式
- 键盘快捷键：空格暂停/播放，左右键快进快退
- 单页应用：返回主页时音乐继续播放

## 技术栈

| 类别 | 依赖 |
|------|------|
| 桌面壳 | electron |
| 打包 | electron-builder (NSIS) |
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
npm install
```

> 首次安装 Electron 二进制若失败，可切换 npmmirror 镜像：
> `$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"; node node_modules/electron/install.js`

### 2. 启动方式（二选一）

#### 方式 A：Electron 桌面应用（推荐）

```bash
npm run electron
```

首次启动不预置音乐目录，主页面会提示「请先在设置中选择音乐目录」。
点击主页右上角齿轮图标打开设置窗口 → 浏览选择音乐目录 → 保存，服务自动重启生效。
配置文件存放在：`%AppData%\music-player\config.json`

#### 方式 B：纯 Web 服务

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm start
```

访问 http://localhost:8080

首次启动同样需进入设置：点击主页右上角齿轮 → 跳转 `/settings.html` → 手动输入音乐目录绝对路径 → 保存（写入项目根 `web-config.json` 并热更新）。

也可通过环境变量预配置（跳过设置步骤）：

```powershell
$env:MUSIC_ROOT="D:\你的音乐目录"
$env:PORT="8080"
npm start
```

## 目录结构要求

### 布局一：直接是小项目

```
MUSIC_ROOT/
├── 项目A/                    #中文名
│   ├── 正篇/
│   │   ├── track1.mp3
│   │   ├── track1.lrc        # 歌词（可选）
│   │   └── track2.mp3
│   ├── 插图/
│   │   └── 封面.png
│   └── name.txt              # 编号（可选）
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

项目文件夹内若存在以 RJ 开头加数字的文件或文件夹（如 RJ*******），主页卡片会在封面左上角以悬浮徽章形式显示该编号（半透明黑底白字），卡片标题则显示中文名。

### 封面识别优先级

1. 文件名包含「封面」的图片
2. 没有则遍历所有图片，选择面积最小的

> 缩略图服务 `/api/thumbnail` 会将原图按 4:3 比例生成缩略图（默认 400×300），与卡片展示比例一致，避免前端变形。缓存文件名形如 `<hash>_400x300.jpg`。

### 歌词匹配优先级

1. 同名文件：track1.mp3 -> track1.lrc / track1.vtt
2. 完整文件名+扩展名：track1.mp3 -> track1.mp3.vtt
3. 目录内任意 .lrc / .vtt 文件

## API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | / | 主页面（SPA） |
| GET | /settings.html | 设置面板（Electron 内嵌） |
| GET | /api/projects | 获取所有项目列表 |
| GET | /api/browse/:projectId | 浏览项目根目录 |
| GET | /api/browse/:projectId/:subpath | 浏览项目子目录 |
| GET | /api/audio/:projectId/:subpath | 音频流（支持 Range） |
| GET | /api/lyrics/:projectId/:subpath | 歌词文件 |
| GET | /api/image/:projectId/:subpath | 原图预览（仅 image/* MIME） |
| GET | /api/thumbnail?path=&size= | 缩略图（自动生成缓存） |
| GET | /api/refresh | 强制重新扫描 |
| GET | /api/cache/size | 缩略图缓存大小与文件数 |
| POST | /api/cache/clear | 清空缩略图与扫描缓存 |
| GET | /api/config | 读取当前运行时配置（不含敏感字段） |
| POST | /api/config | 保存配置（Web 模式专用，写 web-config.json 并热更新） |

## 键盘快捷键

| 按键 | 功能 |
|------|------|
| 空格 | 播放/暂停 |
| 左箭头 | 后退 5 秒 |
| 右箭头 | 前进 5 秒 |
| Esc | 关闭图片预览弹窗 |

## 缓存

- 内存缓存（node-cache）：项目列表，TTL 5 分钟
- 文件缓存（cache.json）：持久化扫描结果，重启时自动加载
- 缩略图缓存（thumbnails/）：首次访问生成，后续直接返回

点击主页右上角「刷新」按钮可强制重新扫描。

## 项目结构

```
asmr/
├── main.js                # Electron 主进程（窗口/托盘/IPC/生命周期）
├── preload.js             # contextBridge 安全 IPC 桥
├── server.js              # Express 服务器，导出 startServer(options)
├── lib/
│   └── config.js          # 配置管理器（读写 userData/config.json）
├── package.json           # 含 electron-builder 打包配置
├── .gitignore
├── README.md              # 本文档
├── public/                # 静态前端
│   ├── index.html         # SPA 主页面
│   ├── settings.html      # 设置面板
│   ├── css/
│   │   ├── main.css       # 网格视图样式
│   │   ├── detail.css     # 详情页 + 播放器样式
│   │   └── settings.css   # 设置面板样式
│   ├── js/
│   │   ├── app.js         # 主逻辑
│   │   ├── player.js      # 播放器核心
│   │   ├── lyrics.js      # 歌词解析与同步
│   │   └── settings.js    # 设置面板逻辑（优先走 IPC，回退 HTTP）
│   └── assets/
│       └── default-cover.png
├── thumbnails/            # 缩略图缓存（git忽略）
└── cache.json             # 数据缓存（git忽略）
```

## 桌面应用打包

打包为 Windows NSIS 安装包（`音乐播放器-Setup-0.1.0.exe`）：

```bash
npm run dist            # 生成 NSIS 安装包到 dist/
npm run dist:portable   # 生成免安装便携版
npm run pack            # 仅解包到 dist/win-unpacked/（不压缩，便于快速验证）
```

打包要点：

- `asar` 打包，sharp 与 `@img` 原生模块通过 `asarUnpack` 解包
- `signAndEditExecutable: false` 跳过 Windows 代码签名（无证书环境友好）
- `cross-env CI=false` 防止 electron-builder 误触发 GitHub 发布
- 首次启动后配置写入 `%AppData%\music-player\config.json`，可便携迁移

## 生产部署（Web 模式）

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
| MUSIC_ROOT | server.js 内置 | 音乐根目录（Web 模式） |
| PORT | 8080 | 服务端口 |

> 桌面应用模式下不读取环境变量，配置以 `%AppData%\music-player\config.json` 为准。

## 许可证

MIT

## 更新日志

### v0.0.1

- 初始版本：目录扫描、音频播放、歌词同步、缩略图生成、SPA 持久播放

### v0.0.2

- 歌词点击跳转：点击任意歌词行跳转音频到对应时间戳
- 歌词 5 秒自动回位：用户手动滚动浏览歌词 5 秒后自动回位到当前播放行
- 图片浏览器预览：点击项目内图片文件，浏览器内弹窗查看原图（Esc / 点遮罩关闭）
- 新增 `/api/image/:projectId/:subpath` 接口（仅允许 image/* MIME）

### v0.0.3

- 封面比例改为 4:3（原本为 1:1），缩略图服务端按 4:3 生成，前端无变形
- RJ 编号改为悬浮在封面左上角（半透明黑底白字），不再占用标题位置
- 卡片标题改用中文名，纯黑色显示，白底卡片
- 删除副标题行，标题支持多行（最多 3 行省略），所有卡片白底高度统一
- 修复缩略图被 sharp 裁成正方形导致前端拉伸变形的问题

### v0.0.4

- 配色重构：移除蓝色 accent，换用极简暗色灰白体系（`#18181b` / `#27272a` / `#fafafa`），CSS 变量统一管理
- Header：半透明 + backdrop-filter 毛玻璃
- 卡片：微边框 + 多层阴影 + hover 过渡更细腻，RJ 徽章毛玻璃
- 播放栏：毛玻璃背景，进度条/音量条 hover 变粗，播放键白底黑字
- 文件列表：当前播放项加左侧白色指示条
- 弹窗：歌词/图片预览 overlay 加 blur + fadeIn 动画
- 交互：统一 cubic-bezier 过渡、按钮 `:active` 缩放、细滚动条

### v0.1.0

- 桌面应用化：基于 Electron 封装为独立窗口应用，单实例锁，系统托盘常驻
- 设置面板：图形化配置音乐目录 / 缓存目录 / 服务端口 / 最小化到托盘 / 开机自启
- 配置持久化：`%AppData%\music-player\config.json`，便携迁移
- server.js 重构：导出 `startServer(options)`，运行时配置可通过 `getCfg()` 动态读取
- 缓存管理：新增 `/api/cache/size`、`/api/cache/clear` 接口及设置面板一键清理
- 安全 IPC：`contextBridge` + `contextIsolation`，preload 暴露 `window.electronAPI`
- 打包：electron-builder NSIS 安装包，sharp 原生模块 asarUnpack 解包，跳过代码签名

### v0.1.1

- 设置入口：主页右上角新增齿轮图标，Electron 打开独立设置窗口，Web 跳转 `/settings.html`
- 空目录引导：移除硬编码默认音乐目录，首次启动所有数据接口返回「请先在设置中选择音乐目录」
- Web 模式配置保存：新增 POST `/api/config`，写入 `web-config.json` 并热更新运行时目录
- 设置页字体修复：settings.css 误用不存在的 CSS 变量导致字体黑色不可见，已统一为 `--text-primary` 等
- 文件夹选择修复：`dialog.showOpenDialog` 绑定父窗口，避免弹窗被遮挡；仅 header 区域可拖动窗口
- Web 模式下输入框解除 readonly，支持手动输入路径

### v0.1.2

- 修复 Web 模式静默失败：Express 5 的 `app.listen` 在端口绑定失败时仍会触发 listen 回调并打印误导性的「已启动」消息，导致服务器实际未监听但看似成功
- 显式监听 `error` 事件：`EACCES` / `EADDRINUSE` 时打印可操作的中文错误信息（含 Windows 保留端口查询命令与替代端口启动示例）
- Web 模式下绑定失败以非零码退出进程（原为 `0`，导致 `npm start` 误判成功）
- 默认端口从 `3000` 改为 `8080`：`3000` 常被 Windows / Hyper-V / WSL2 划入保留端口范围（`2997-3096`），导致 `EACCES` 权限拒绝
- 同步更新 `lib/config.js`、`settings.html`、`settings.js`、`README` 中的默认端口


### v0.1.3

- Electron 主进程会等待内嵌 Express 真正进入 `listening` 后再加载或重载界面，避免端口占用和重启时的假启动。
- 路径访问增加根目录边界校验，`/music`、`/thumbnails`、`/api/thumbnail`、`/api/image`、`/api/audio`、`/api/lyrics` 统一防止路径逃逸。
- 清理缓存时会同时清掉缩略图缓存、文件扫描缓存和内存扫描缓存，刷新结果更一致。
- 前端加载增加竞态保护，项目列表、目录、歌词只接受最新响应，避免慢请求覆盖新状态。
- 播放器切换同项目内目录时会按目录键重置播放索引，减少旧播放队列残留。
