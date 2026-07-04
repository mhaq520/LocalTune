// 全局播放器管理
const Player = {
  audio: null,
  playlist: [],
  currentIndex: -1,
  currentProjectId: '',

  init() {
    if (this.audio) return;
    this.audio = new Audio();
    this.audio.volume = parseFloat(localStorage.getItem('player_volume') || '0.8');

    this.audio.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.audio.addEventListener('play', () => this.onPlay());
    this.audio.addEventListener('pause', () => this.onPause());
    this.audio.addEventListener('ended', () => this.onEnded());
    this.audio.addEventListener('loadedmetadata', () => this.onLoaded());
  },

  // 设置播放列表
  setPlaylist(projectId, tracks) {
    // 如果切换了项目，重置索引
    if (this.currentProjectId !== projectId) {
      this.currentIndex = -1;
    }
    this.playlist = tracks;
    this.currentProjectId = projectId;
  },

  // 编码路径（每段分别编码，保留 / 作为分隔符）
  encodePath(p) {
    return p.split('/').map(s => encodeURIComponent(s)).join('/');
  },

  // 播放指定索引
  play(index) {
    if (index < 0 || index >= this.playlist.length) return;
    this.currentIndex = index;
    const track = this.playlist[index];
    const relPath = track.relPath || track.name;
    // projectId 用 encodeURIComponent（/ 编码为 %2F），relPath 用 encodePath（保留 /）
    const src = `/api/audio/${encodeURIComponent(this.currentProjectId)}/${this.encodePath(relPath)}`;
    this.audio.src = src;
    this.audio.play().catch(() => {});

    this.updateNowPlaying();
    this.updateTrackListHighlight();
  },

  // 播放/暂停切换
  togglePlay() {
    if (!this.audio.src) {
      if (this.playlist.length > 0) {
        this.play(0);
      }
      return;
    }
    if (this.audio.paused) {
      this.audio.play().catch(() => {});
    } else {
      this.audio.pause();
    }
  },

  // 上一首
  prev() {
    if (this.playlist.length === 0) return;
    const idx = this.currentIndex > 0 ? this.currentIndex - 1 : this.playlist.length - 1;
    this.play(idx);
  },

  // 下一首
  next() {
    if (this.playlist.length === 0) return;
    const idx = this.currentIndex < this.playlist.length - 1 ? this.currentIndex + 1 : 0;
    this.play(idx);
  },

  // 进度条跳转
  seek(percent) {
    if (!this.audio.duration || isNaN(this.audio.duration)) return;
    this.audio.currentTime = (percent / 100) * this.audio.duration;
  },

  // 设置音量
  setVolume(vol) {
    this.audio.volume = vol / 100;
    localStorage.setItem('player_volume', String(vol / 100));
  },

  // 时间更新
  onTimeUpdate() {
    const progress = document.getElementById('progressBar');
    const currentTime = document.getElementById('currentTime');
    if (progress && this.audio.duration) {
      progress.value = (this.audio.currentTime / this.audio.duration) * 100;
    }
    if (currentTime) {
      currentTime.textContent = formatTime(this.audio.currentTime);
    }

    // 歌词同步
    if (typeof Lyrics !== 'undefined' && Lyrics.current) {
      Lyrics.sync(this.audio.currentTime);
    }
  },

  onPlay() {
    const btn = document.getElementById('playBtn');
    const miniBtn = document.getElementById('miniPlayBtn');
    if (btn) btn.innerHTML = '&#9646;&#9646;';
    if (miniBtn) miniBtn.innerHTML = '&#9646;&#9646;';
    this.updateTrackListHighlight();
  },

  onPause() {
    const btn = document.getElementById('playBtn');
    const miniBtn = document.getElementById('miniPlayBtn');
    if (btn) btn.innerHTML = '&#9654;';
    if (miniBtn) miniBtn.innerHTML = '&#9654;';
    this.updateTrackListHighlight();
  },

  onEnded() {
    this.next();
    // 触发歌词加载（通过自定义事件）
    document.dispatchEvent(new CustomEvent('trackChanged'));
  },

  onLoaded() {
    const duration = document.getElementById('duration');
    if (duration) {
      duration.textContent = formatTime(this.audio.duration);
    }
  },

  updateNowPlaying() {
    const track = this.playlist[this.currentIndex];
    const np = document.getElementById('nowPlaying');
    const mini = document.getElementById('miniSongName');
    const name = track ? track.name : '';
    if (np) np.textContent = name;
    if (mini && track) mini.textContent = name;
  },

  updateTrackListHighlight() {
    document.querySelectorAll('.audio-item').forEach((item) => {
      const idx = parseInt(item.dataset.audioIndex);
      item.classList.toggle('active', idx === this.currentIndex);
      const status = item.querySelector('.track-status');
      if (status) {
        if (idx === this.currentIndex && !this.audio.paused) {
          status.textContent = '播放中';
        } else if (idx === this.currentIndex) {
          status.textContent = '暂停';
        } else {
          status.textContent = '';
        }
      }
    });
  }
};

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 初始化播放器
Player.init();
