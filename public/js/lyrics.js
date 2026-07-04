const Lyrics = {
  current: [],       // 当前歌词数组 [{time, text}]
  activeIndex: -1,
  isUserScrolling: false,   // 用户是否正在手动滚动浏览
  autoScrollTimer: null,    // 5 秒自动回位定时器

  // 解析歌词文本（自动检测 LRC / VTT）
  parse(text) {
    if (text.trim().startsWith('WEBVTT')) {
      return this.parseVTT(text);
    }
    return this.parseLRC(text);
  },

  // 解析LRC
  parseLRC(text) {
    const lines = text.split('\n');
    const result = [];
    const tagRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

    for (const line of lines) {
      const match = line.match(tagRegex);
      if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseInt(match[2]);
        let ms = parseInt(match[3]);
        if (match[3].length === 2) ms = ms * 10;
        const time = minutes * 60 + seconds + ms / 1000;
        const text = match[4].trim();
        result.push({ time, text: text || '...' });
      }
    }

    result.sort((a, b) => a.time - b.time);
    return result;
  },

  // 解析VTT
  parseVTT(text) {
    const lines = text.split('\n');
    const result = [];
    const timeRegex = /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;

    let i = 0;
    // 跳过 WEBVTT 头部
    while (i < lines.length && !timeRegex.test(lines[i])) {
      i++;
    }

    for (; i < lines.length; i++) {
      const match = lines[i].match(timeRegex);
      if (match) {
        const h1 = parseInt(match[1]), m1 = parseInt(match[2]), s1 = parseInt(match[3]), ms1 = parseInt(match[4]);
        const time = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000;

        // 收集后续文本行（直到空行或下一个时间戳）
        const textLines = [];
        i++;
        while (i < lines.length && lines[i].trim() !== '' && !timeRegex.test(lines[i])) {
          const t = lines[i].trim();
          if (t && !/^\d+$/.test(t)) {
            textLines.push(t);
          }
          i++;
        }
        i--; // 回退，让外层循环处理

        const text = textLines.join(' ').trim();
        result.push({ time, text: text || '...' });
      }
    }

    result.sort((a, b) => a.time - b.time);
    return result;
  },

  // 加载歌词
  async load(lrcPath) {
    if (!lrcPath) {
      this.current = [];
      this.render();
      return;
    }

    try {
      const res = await fetch(lrcPath);
      const text = await res.text();
      this.current = this.parse(text);
      this.activeIndex = -1;
      this.render();
    } catch (e) {
      this.current = [];
      this.render();
    }
  },

  // 渲染歌词到弹窗
  render() {
    const content = document.getElementById('lyricsContent');
    if (!content) return;

    if (this.current.length === 0) {
      content.innerHTML = '<p class="no-lyrics">暂无歌词</p>';
      return;
    }

    content.innerHTML = this.current.map((l, i) =>
      `<p data-index="${i}" data-time="${l.time}">${escapeHtml(l.text)}</p>`
    ).join('');
  },

  // 同步歌词
  sync(currentTime) {
    if (this.current.length === 0) return;

    let newIndex = -1;
    for (let i = 0; i < this.current.length; i++) {
      if (this.current[i].time <= currentTime) {
        newIndex = i;
      } else {
        break;
      }
    }

    if (newIndex !== this.activeIndex) {
      this.activeIndex = newIndex;
      this.highlight();
    }
  },

  // 高亮当前行
  highlight() {
    const content = document.getElementById('lyricsContent');
    if (!content) return;

    const allP = content.querySelectorAll('p');
    allP.forEach(p => p.classList.remove('active'));

    if (this.activeIndex >= 0) {
      const active = content.querySelector(`p[data-index="${this.activeIndex}"]`);
      if (active) {
        active.classList.add('active');
        // 用户手动滚动浏览期间不强制回位（5 秒定时器到时会统一回位）
        if (!this.isUserScrolling) {
          active.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  },

  // 初始化：点击歌词跳转 + 用户滚动检测（5 秒后自动回位）
  // 仅绑定一次，依赖事件委托，render() 后无需重新绑定
  init() {
    const content = document.getElementById('lyricsContent');
    if (!content) return;

    // 点击歌词行 → 跳转音频到对应时间戳
    content.addEventListener('click', (e) => {
      const p = e.target.closest('p[data-time]');
      if (!p) return;
      const time = parseFloat(p.dataset.time);
      if (isNaN(time)) return;

      // 取消「用户滚动」状态，让 highlight 能立即 scrollIntoView 到点击行
      this.isUserScrolling = false;
      clearTimeout(this.autoScrollTimer);

      if (typeof Player !== 'undefined' && Player.audio) {
        try {
          Player.audio.currentTime = time;
        } catch (_) {}
      }

      // 立即设置 active 并高亮，避免依赖 timeupdate 时机
      const idx = parseInt(p.dataset.index);
      if (!isNaN(idx)) {
        this.activeIndex = idx;
        this.highlight();
      }
    });

    // 用户手动滚动检测：wheel / touchmove / 拖动滚动条 / 键盘滚动键
    // 注意：scrollIntoView 不会触发这些事件，故可区分用户与程序滚动
    const onUserScroll = () => {
      this.isUserScrolling = true;
      clearTimeout(this.autoScrollTimer);
      this.autoScrollTimer = setTimeout(() => {
        this.isUserScrolling = false;
        this.highlight();
      }, 5000);
    };

    content.addEventListener('wheel', onUserScroll);
    content.addEventListener('touchmove', onUserScroll);
    content.addEventListener('mousedown', (e) => {
      // 点击滚动条区域（内容宽度之外但元素内）
      const rect = content.getBoundingClientRect();
      if (e.clientX > rect.left + content.clientWidth) {
        onUserScroll();
      }
    });
    content.addEventListener('keydown', (e) => {
      if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        onUserScroll();
      }
    });
  },

  // 显示/隐藏歌词弹窗
  toggle() {
    const overlay = document.getElementById('lyricsOverlay');
    if (overlay) {
      overlay.classList.toggle('hidden');
    }
  },

  // 初始化歌词弹窗拖拽
  initDrag() {
    const overlay = document.getElementById('lyricsOverlay');
    const box = document.getElementById('lyricsBox');
    if (!overlay || !box) return;

    let isDragging = false;
    let startX, startY, offsetX, offsetY;

    const header = box.querySelector('.lyrics-header');
    if (!header) return;

    header.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = box.getBoundingClientRect();
      offsetX = startX - rect.left;
      offsetY = startY - rect.top;
      box.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const x = e.clientX - offsetX;
      const y = e.clientY - offsetY;
      box.style.position = 'absolute';
      box.style.left = x + 'px';
      box.style.top = y + 'px';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}