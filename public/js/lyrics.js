const Lyrics = {
  current: [],
  activeIndex: -1,
  isUserScrolling: false,
  autoScrollTimer: null,
  loadSeq: 0,
  initialized: false,
  dragInitialized: false,

  parse(text) {
    if (text.trim().startsWith('WEBVTT')) {
      return this.parseVTT(text);
    }
    return this.parseLRC(text);
  },

  parseLRC(text) {
    const lines = text.split('\n');
    const result = [];
    const tagRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

    for (const line of lines) {
      const match = line.match(tagRegex);
      if (!match) continue;

      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      let ms = parseInt(match[3], 10);
      if (match[3].length === 2) ms *= 10;
      const time = minutes * 60 + seconds + ms / 1000;
      const text = match[4].trim();
      result.push({ time, text: text || '...' });
    }

    result.sort((a, b) => a.time - b.time);
    return result;
  },

  parseVTT(text) {
    const lines = text.split('\n');
    const result = [];
    const timeRegex = /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;

    let i = 0;
    while (i < lines.length && !timeRegex.test(lines[i])) {
      i++;
    }

    for (; i < lines.length; i++) {
      const match = lines[i].match(timeRegex);
      if (!match) continue;

      const h1 = parseInt(match[1], 10);
      const m1 = parseInt(match[2], 10);
      const s1 = parseInt(match[3], 10);
      const ms1 = parseInt(match[4], 10);
      const time = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000;

      const textLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '' && !timeRegex.test(lines[i])) {
        const t = lines[i].trim();
        if (t && !/^\d+$/.test(t)) {
          textLines.push(t);
        }
        i++;
      }
      i--;

      const text = textLines.join(' ').trim();
      result.push({ time, text: text || '...' });
    }

    result.sort((a, b) => a.time - b.time);
    return result;
  },

  async load(lrcPath) {
    const requestSeq = ++this.loadSeq;

    if (!lrcPath) {
      this.current = [];
      this.activeIndex = -1;
      this.render();
      return;
    }

    try {
      const res = await fetch(lrcPath);
      const text = await res.text();
      if (requestSeq !== this.loadSeq) return;

      this.current = this.parse(text);
      this.activeIndex = -1;
      this.render();

      if (typeof Player !== 'undefined' && Player.audio) {
        this.sync(Player.audio.currentTime || 0);
      }
    } catch (_) {
      if (requestSeq !== this.loadSeq) return;
      this.current = [];
      this.activeIndex = -1;
      this.render();
    }
  },

  render() {
    const content = document.getElementById('lyricsContent');
    if (!content) return;

    if (this.current.length === 0) {
      this.activeIndex = -1;
      content.innerHTML = '<p class="no-lyrics">暂无歌词</p>';
      return;
    }

    content.innerHTML = this.current.map((l, i) =>
      `<p data-index="${i}" data-time="${l.time}">${escapeHtml(l.text)}</p>`
    ).join('');
  },

  sync(currentTime) {
    if (this.current.length === 0) return;

    let lo = 0;
    let hi = this.current.length - 1;
    let newIndex = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.current[mid].time <= currentTime) {
        newIndex = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (newIndex !== this.activeIndex) {
      this.activeIndex = newIndex;
      this.highlight();
    }
  },

  highlight() {
    const content = document.getElementById('lyricsContent');
    if (!content) return;

    const allP = content.querySelectorAll('p');
    allP.forEach((p) => p.classList.remove('active'));

    if (this.activeIndex < 0) return;

    const active = content.querySelector(`p[data-index="${this.activeIndex}"]`);
    if (!active) return;

    active.classList.add('active');
    if (!this.isUserScrolling && active.isConnected) {
      active.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  },

  init() {
    if (this.initialized) return;

    const content = document.getElementById('lyricsContent');
    if (!content) return;

    content.addEventListener('click', (e) => {
      const p = e.target.closest('p[data-time]');
      if (!p) return;

      const time = parseFloat(p.dataset.time);
      if (Number.isNaN(time)) return;

      this.isUserScrolling = false;
      clearTimeout(this.autoScrollTimer);

      if (typeof Player !== 'undefined' && Player.audio) {
        try {
          Player.audio.currentTime = time;
        } catch (_) {}
      }

      const idx = parseInt(p.dataset.index, 10);
      if (!Number.isNaN(idx)) {
        this.activeIndex = idx;
        this.highlight();
      }
    });

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

    this.initialized = true;
  },

  toggle() {
    const overlay = document.getElementById('lyricsOverlay');
    if (overlay) {
      overlay.classList.toggle('hidden');
    }
  },

  initDrag() {
    if (this.dragInitialized) return;

    const overlay = document.getElementById('lyricsOverlay');
    const box = document.getElementById('lyricsBox');
    if (!overlay || !box) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let offsetX = 0;
    let offsetY = 0;

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

    this.dragInitialized = true;
  }
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
