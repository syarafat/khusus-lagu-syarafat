// Pemutar YouTube resmi (YouTube IFrame Player API) yang dibungkus agar perilakunya
// mirip elemen <audio>, sehingga bisa dipakai mesin pemutar yang sama (antrean, acak, dll.).

let apiPromise = null;

function loadApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === 'function') prev();
        resolve(window.YT);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => {
        apiPromise = null;
        s.remove();
        reject(new Error('offline'));
      };
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

/** Ambil ID video dari berbagai bentuk link YouTube / YouTube Music. */
export function parseYouTubeId(raw) {
  const text = String(raw || '').trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  let url;
  try { url = new URL(text); } catch { return null; }
  const host = url.hostname.replace(/^(www\.|m\.)/, '');
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    const v = url.searchParams.get('v');
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
    if (m) return m[1];
  }
  return null;
}

export function isYouTubeUrl(raw) {
  try {
    const host = new URL(String(raw).trim()).hostname.replace(/^(www\.|m\.)/, '');
    return ['youtu.be', 'youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host);
  } catch { return false; }
}

export const YT_ERRORS = {
  2: 'Link video YouTube tidak valid.',
  5: 'Video ini tidak bisa diputar di browser.',
  100: 'Video tidak ditemukan, sudah dihapus, atau dijadikan privat.',
  101: 'Pemilik video tidak mengizinkan video ini diputar di aplikasi lain.',
  150: 'Pemilik video tidak mengizinkan video ini diputar di aplikasi lain.',
  153: 'Video ini tidak bisa diputar di aplikasi lain.',
};

export class YTEngine extends EventTarget {
  constructor(mountId) {
    super();
    this.mountId = mountId;
    this.player = null;
    this.ready = false;
    this.videoId = null; // video yang sudah dimuat ke player
    this.paused = true;
    this.ended = false;
    this.playbackRate = 1;
    this.errorCode = null;
    this._volume = 0.8;
    this._muted = false;
    this._dur = 0;
    this.timer = 0;
    this.token = 0;
    this.wanted = false; // true sejak lagu YouTube diminta diputar sampai dihentikan
  }

  fire(type) { this.dispatchEvent(new Event(type)); }

  get active() { return !!(this.ready && this.videoId); }

  get currentTime() {
    try { return (this.ready && this.player.getCurrentTime()) || 0; } catch { return 0; }
  }

  set currentTime(t) {
    if (!this.ready) return;
    try {
      this.player.seekTo(Math.max(0, t), true);
      this.ended = false;
      this.fire('seeked');
      this.fire('timeupdate');
    } catch { /* abaikan */ }
  }

  get duration() {
    try {
      const d = this.ready ? this.player.getDuration() : 0;
      return d > 0 ? d : this._dur;
    } catch { return this._dur; }
  }

  get volume() { return this._volume; }
  set volume(v) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.ready) { try { this.player.setVolume(Math.round(this._volume * 100)); } catch { /* abaikan */ } }
  }

  get muted() { return this._muted; }
  set muted(m) {
    this._muted = !!m;
    if (this.ready) { try { if (this._muted) this.player.mute(); else this.player.unMute(); } catch { /* abaikan */ } }
  }

  /** Muat video. autoplay=false hanya menyiapkan (cue) tanpa memutar. */
  async load(id, autoplay = true, startAt = 0) {
    const token = ++this.token;
    this.wanted = true;
    this.errorCode = null;
    this.ended = false;
    this.paused = true;
    this._dur = 0;
    const start = Math.max(0, Math.floor(startAt || 0));
    const YT = await loadApi();
    if (token !== this.token) return;
    if (!this.player) {
      await new Promise((resolve) => {
        this.player = new YT.Player(this.mountId, {
          width: '100%',
          height: '100%',
          videoId: id,
          playerVars: { autoplay: autoplay ? 1 : 0, playsinline: 1, rel: 0, start, origin: location.origin },
          events: {
            onReady: () => {
              this.ready = true;
              this.volume = this._volume;
              this.muted = this._muted;
              if (autoplay) { try { this.player.playVideo(); } catch { /* abaikan */ } }
              resolve();
            },
            onStateChange: (e) => this.onState(e.data),
            onError: (e) => this.onError(e.data),
          },
        });
      });
    } else if (autoplay) {
      this.player.loadVideoById({ videoId: id, startSeconds: start });
    } else {
      this.player.cueVideoById({ videoId: id, startSeconds: start });
    }
    if (token !== this.token) return;
    this.videoId = id;
    this.fire('loadedmetadata');
  }

  play() {
    if (this.ready) { try { this.player.playVideo(); } catch { /* abaikan */ } }
    return Promise.resolve();
  }

  pause() {
    // status 'paused' diperbarui oleh event PAUSED dari YouTube (onState)
    if (this.ready) { try { this.player.pauseVideo(); } catch { /* abaikan */ } }
  }

  stop() {
    this.token++;
    if (this.ready && this.videoId) { try { this.player.stopVideo(); } catch { /* abaikan */ } }
    this.videoId = null;
    this.wanted = false;
    const wasPlaying = !this.paused;
    this.paused = true;
    this.stopTimer();
    if (wasPlaying) this.fire('pause');
  }

  onState(s) {
    const YTS = (window.YT && window.YT.PlayerState) || { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
    if (s === YTS.PLAYING) {
      const wasPaused = this.paused;
      this.paused = false;
      this.ended = false;
      if (wasPaused) this.fire('play');
      this.fire('playing');
      this.fire('durationchange');
      this.startTimer();
    } else if (s === YTS.PAUSED) {
      if (!this.paused) { this.paused = true; this.fire('pause'); }
      this.stopTimer();
      this.fire('timeupdate');
    } else if (s === YTS.ENDED) {
      this.paused = true;
      this.ended = true;
      this.stopTimer();
      this.fire('ended');
    } else if (s === YTS.CUED) {
      this.fire('durationchange');
    }
  }

  onError(code) {
    this.errorCode = code;
    this.paused = true;
    this.stopTimer();
    this.fire('error');
  }

  startTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => this.fire('timeupdate'), 250);
  }

  stopTimer() {
    clearInterval(this.timer);
    this.timer = 0;
  }
}
