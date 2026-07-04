const Lyrics = {
  current: [],       // 当前歌词数组 [{time, text}]
  activeIndex: -1,

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
      `<p data-index="${i}">${escapeHtml(l.text)}</p>`
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
        active.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
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