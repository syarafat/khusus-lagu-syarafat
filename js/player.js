// Mesin pemutar: antrean, acak, ulangi, timer tidur, kontrol layar kunci (Media Session).
// Memakai dua "mesin": elemen <audio> untuk file di perangkat/link, dan YTEngine untuk YouTube.
import { store } from './store.js';
import { YT_ERRORS } from './ytengine.js';

const SAVE_KEY = 'lagu-playback';
const MEDIA_EVENTS = ['play', 'pause', 'playing', 'ended', 'error', 'timeupdate', 'durationchange', 'seeked', 'loadedmetadata'];

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Player extends EventTarget {
  constructor(audio, yt) {
    super();
    this.audio = audio;
    this.yt = yt;
    this.queue = [];
    this.original = null; // urutan asli sebelum diacak
    this.index = -1;
    this.context = { type: 'library', id: null, label: 'Semua lagu' };
    this.shuffle = !!store.settings.shuffle;
    this.repeat = store.settings.repeat || 'off';
    this.objectUrl = null;
    this.token = 0;
    this.counted = false;
    this.errorStreak = 0;
    this.sleep = null;
    this.fading = false;
    this.lastSave = 0;
    this.lastPos = 0;
    this.remote = null; // mode tamu Dengar Bareng: { command(c) }
    this.remoteSong = null;
    this.snapshot = null;

    audio.volume = store.settings.volume ?? 0.8;
    audio.muted = !!store.settings.muted;
    yt.volume = audio.volume;
    yt.muted = audio.muted;

    const handlers = {
      play: () => this.onState(),
      pause: () => { this.onState(); this.save(); },
      playing: () => { this.errorStreak = 0; this.onState(); },
      ended: () => this.onEnded(),
      error: (e) => this.onError(e),
      timeupdate: () => this.onTime(),
      durationchange: () => this.onDuration(),
      seeked: () => { this.updatePosition(true); this.emit('time'); },
      loadedmetadata: () => this.emit('time'),
    };
    for (const engine of [audio, yt]) {
      MEDIA_EVENTS.forEach((type) => engine.addEventListener(type, (e) => {
        if (engine !== this.media) return; // abaikan event dari mesin yang tidak aktif
        handlers[type](e);
      }));
    }
    audio.addEventListener('volumechange', () => this.emit('volume'));

    store.subscribe((type, detail) => {
      if (type === 'songs-deleted') this.onSongsDeleted(detail);
      else if (type === 'songs') { this.updateMediaSession(); this.emit('track'); }
    });

    this.setupMediaSession();
    window.addEventListener('pagehide', () => this.save(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(true); });
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  get current() {
    if (this.remote) return this.remoteSong;
    return this.index >= 0 ? store.get(this.queue[this.index]) || null : null;
  }
  get currentId() {
    if (this.remote) return this.remoteSong ? this.remoteSong.id : null;
    return this.index >= 0 ? this.queue[this.index] : null;
  }
  get isYouTube() { return this.current?.source === 'youtube'; }
  /** Mesin yang sedang dipakai lagu sekarang. */
  get media() { return this.isYouTube ? this.yt : this.audio; }
  get isPlaying() { return !this.media.paused && !this.media.ended; }
  get time() { return this.media.currentTime || (this.isLoaded ? 0 : this.lastPos) || 0; }
  get duration() {
    const d = this.media.duration;
    if (Number.isFinite(d) && d > 0) return d;
    return this.current?.duration || 0;
  }
  /** Apakah lagu sekarang sudah dimuat ke mesinnya. */
  get isLoaded() {
    const s = this.current;
    if (!s) return false;
    if (this.remote) return !!this.audio.getAttribute('src');
    return s.source === 'youtube' ? this.yt.active && this.yt.videoId === s.ytId : !!this.audio.getAttribute('src');
  }

  /** Saat jadi tamu Dengar Bareng, lagu diatur HP pembuat sesi. */
  blockedByRemote() {
    if (!this.remote) return false;
    this.emit('error', 'Kamu sedang Dengar Bareng. Lagu diatur oleh HP pembuat sesi — keluar dari sesi untuk memutar lagumu sendiri.');
    return true;
  }

  // ---------- Memutar ----------
  async playList(ids, start = 0, context = null, opts = {}) {
    if (this.blockedByRemote()) return;
    ids = ids.filter((id) => store.get(id));
    if (!ids.length) return;
    this.errorStreak = 0;
    if (opts.shuffle !== undefined && opts.shuffle !== this.shuffle) {
      this.shuffle = opts.shuffle;
      store.saveSettings({ shuffle: this.shuffle });
      this.emit('modes');
    }
    if (context) this.context = context;
    if (start < 0 || start >= ids.length) start = this.shuffle ? Math.floor(Math.random() * ids.length) : 0;
    if (this.shuffle) {
      const first = ids[start];
      const rest = ids.filter((_, i) => i !== start);
      this.original = ids.slice();
      this.queue = [first, ...shuffleArray(rest)];
      this.index = 0;
    } else {
      this.original = null;
      this.queue = ids.slice();
      this.index = start;
    }
    this.emit('queue');
    await this.load(true);
  }

  async load(autoplay, startAt = 0) {
    const token = ++this.token;
    const song = this.current;
    if (!song) { this.stop(); return; }
    this.counted = false;
    this.lastPos = startAt || 0;

    if (song.source === 'youtube') {
      // Hentikan audio biasa, pakai player YouTube
      this.audio.pause();
      this.audio.removeAttribute('src');
      try { this.audio.load(); } catch { /* abaikan */ }
      if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
      this.emit('track');
      this.updateMediaSession();
      if (autoplay) {
        this.emit('yt-loading');
        try {
          await this.yt.load(song.ytId, true, startAt);
        } catch {
          if (token === this.token) {
            this.yt.stop();
            this.emit('track');
            this.fail('Lagu YouTube butuh koneksi internet.');
          }
          return;
        }
      } else {
        this.yt.stop(); // disiapkan saja; dimuat saat tombol putar ditekan
      }
      if (token !== this.token) return;
      this.onState();
      this.emit('track');
      this.save(true);
      return;
    }

    this.yt.stop();
    let src;
    let objectUrl = null;
    if (song.source === 'url') {
      src = song.url;
    } else {
      let blob = null;
      try { blob = await store.audioBlob(song.id); } catch { blob = null; }
      if (token !== this.token) return;
      if (!blob) { this.fail('File lagu tidak ditemukan.'); return; }
      objectUrl = URL.createObjectURL(blob);
      src = objectUrl;
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = objectUrl;
    this.audio.src = src;
    if (startAt > 0) {
      const seekOnce = () => {
        if (token === this.token) {
          try { this.audio.currentTime = Math.min(startAt, Math.max(0, (this.audio.duration || startAt + 1) - 1)); } catch { /* abaikan */ }
        }
      };
      this.audio.addEventListener('loadedmetadata', seekOnce, { once: true });
    }
    this.emit('track');
    this.updateMediaSession();
    if (autoplay) await this.safePlay();
    else this.onState();
    this.save(true);
  }

  async safePlay() {
    try {
      await this.media.play();
    } catch (err) {
      if (err && err.name === 'NotAllowedError') this.emit('error', 'Ketuk tombol putar untuk mulai memutar.');
      else if (err && err.name !== 'AbortError') console.warn(err);
    }
    this.onState();
  }

  play() {
    if (this.remote) { this.remote.command({ c: 'play' }); return; }
    if (!this.current) {
      const all = store.all().sort((a, b) => b.addedAt - a.addedAt).map((s) => s.id);
      if (all.length) this.playList(all, this.shuffle ? -1 : 0, { type: 'library', id: null, label: 'Semua lagu' });
      return;
    }
    if (!this.isLoaded) { this.load(true, this.lastPos); return; }
    this.safePlay();
  }

  pause() {
    if (this.remote) { this.remote.command({ c: 'pause' }); return; }
    this.media.pause();
  }
  toggle() { if (this.isPlaying) this.pause(); else this.play(); }

  next(auto = false) {
    if (this.remote) { if (!auto) this.remote.command({ c: 'next' }); return; }
    if (!this.queue.length) return;
    if (!auto) this.errorStreak = 0;
    if (this.index < this.queue.length - 1) {
      this.index++;
      this.load(true);
      return;
    }
    // Sudah di lagu terakhir
    if (this.shuffle && this.repeat === 'all' && this.original) {
      const cur = this.currentId;
      this.queue = shuffleArray(this.queue);
      if (this.queue[0] === cur && this.queue.length > 1) this.queue.push(this.queue.shift());
      this.emit('queue');
    }
    this.index = 0;
    if (auto && this.repeat === 'off') this.load(false);
    else this.load(true);
  }

  prev() {
    if (this.remote) { this.remote.command({ c: 'prev' }); return; }
    if (!this.queue.length) return;
    this.errorStreak = 0;
    if (this.media.currentTime > 3 || (this.index === 0 && this.repeat !== 'all')) {
      if (this.isLoaded) {
        this.media.currentTime = 0;
        if (!this.isPlaying) this.safePlay();
      } else {
        this.load(true);
      }
      return;
    }
    this.index = this.index > 0 ? this.index - 1 : this.queue.length - 1;
    this.load(true);
  }

  seek(t) {
    if (this.remote) { this.remote.command({ c: 'seek', v: Math.max(0, t) }); return; }
    const d = this.duration;
    if (!d || !this.isLoaded) { this.lastPos = Math.max(0, t); this.emit('time'); return; }
    try { this.media.currentTime = Math.max(0, Math.min(d - 0.05, t)); } catch { /* abaikan */ }
    this.emit('time');
  }
  seekBy(delta) { this.seek(this.time + delta); }

  setVolume(v) {
    v = Math.max(0, Math.min(1, v));
    this.audio.volume = v;
    if (v > 0 && this.audio.muted) this.audio.muted = false;
    this.yt.volume = v;
    this.yt.muted = this.audio.muted;
    store.saveSettings({ volume: v, muted: this.audio.muted });
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    if (!this.audio.muted && this.audio.volume === 0) this.audio.volume = 0.5;
    this.yt.muted = this.audio.muted;
    this.yt.volume = this.audio.volume;
    store.saveSettings({ muted: this.audio.muted, volume: this.audio.volume });
  }

  toggleShuffle() {
    if (this.blockedByRemote()) return;
    this.shuffle = !this.shuffle;
    store.saveSettings({ shuffle: this.shuffle });
    const cur = this.currentId;
    if (this.queue.length) {
      if (this.shuffle) {
        this.original = this.queue.slice();
        const rest = this.queue.filter((_, i) => i !== this.index);
        this.queue = cur ? [cur, ...shuffleArray(rest)] : shuffleArray(rest);
        this.index = cur ? 0 : -1;
      } else if (this.original) {
        const extra = this.queue.filter((id) => !this.original.includes(id));
        const q = this.original.filter((id) => store.get(id));
        let idx = cur ? q.indexOf(cur) : -1;
        if (extra.length) q.splice(idx + 1, 0, ...extra.filter((id) => id !== cur));
        if (idx < 0 && cur) { q.unshift(cur); idx = 0; }
        this.queue = q;
        this.index = idx;
        this.original = null;
      }
      this.emit('queue');
      this.save(true);
    }
    this.emit('modes');
  }

  cycleRepeat() {
    if (this.blockedByRemote()) return;
    this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
    store.saveSettings({ repeat: this.repeat });
    this.emit('modes');
  }

  // ---------- Antrean ----------
  playNext(ids) {
    if (this.blockedByRemote()) return;
    ids = ids.filter((id) => store.get(id));
    if (!ids.length) return;
    if (!this.queue.length) { this.playList(ids, 0, { type: 'queue', id: null, label: 'Antrean' }); return; }
    this.queue.splice(this.index + 1, 0, ...ids);
    if (this.original) this.original.push(...ids);
    this.emit('queue');
    this.save(true);
  }

  addToQueue(ids) {
    if (this.blockedByRemote()) return;
    ids = ids.filter((id) => store.get(id));
    if (!ids.length) return;
    if (!this.queue.length) { this.playList(ids, 0, { type: 'queue', id: null, label: 'Antrean' }); return; }
    this.queue.push(...ids);
    if (this.original) this.original.push(...ids);
    this.emit('queue');
    this.save(true);
  }

  jumpTo(i) {
    if (this.remote) return;
    if (i < 0 || i >= this.queue.length) return;
    this.errorStreak = 0;
    this.index = i;
    this.load(true);
  }

  removeAt(i) {
    if (this.remote) return;
    if (i < 0 || i >= this.queue.length) return;
    const id = this.queue[i];
    this.queue.splice(i, 1);
    if (this.original) {
      const k = this.original.indexOf(id);
      if (k >= 0) this.original.splice(k, 1);
    }
    if (i < this.index) this.index--;
    else if (i === this.index) {
      const wasPlaying = this.isPlaying;
      if (!this.queue.length) { this.stop(); return; }
      if (this.index >= this.queue.length) this.index = 0;
      this.load(wasPlaying);
    }
    this.emit('queue');
    this.save(true);
  }

  moveInQueue(from, to) {
    if (from === to || from < 0 || to < 0 || from >= this.queue.length || to >= this.queue.length) return;
    const cur = this.currentId;
    const [x] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, x);
    this.index = this.queue.indexOf(cur);
    this.emit('queue');
    this.save(true);
  }

  clearUpcoming() {
    if (this.index < 0) return;
    this.queue = this.queue.slice(0, this.index + 1);
    if (this.original) this.original = this.queue.slice();
    this.emit('queue');
    this.save(true);
  }

  stop() {
    this.token++;
    this.audio.pause();
    this.audio.removeAttribute('src');
    try { this.audio.load(); } catch { /* abaikan */ }
    this.yt.stop();
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
    this.queue = [];
    this.original = null;
    this.index = -1;
    this.emit('queue');
    this.emit('track');
    this.onState();
    this.updateMediaSession();
    this.save(true);
  }

  /** Hentikan video YouTube (mis. pengguna menutup jendela video). */
  stopYouTube() {
    if (!this.isYouTube) return;
    this.lastPos = this.yt.currentTime || this.lastPos;
    this.token++;
    this.yt.stop();
    this.onState();
    this.emit('track');
    this.save(true);
  }

  onSongsDeleted(ids) {
    if (this.remote) {
      if (this.snapshot) this.snapshot.queue = this.snapshot.queue.filter((id) => !ids.includes(id));
      return;
    }
    if (!this.queue.length) return;
    const gone = new Set(ids);
    const cur = this.currentId;
    const curGone = cur && gone.has(cur);
    const wasPlaying = this.isPlaying;
    let newIndex = 0;
    for (let i = 0; i < this.index; i++) if (!gone.has(this.queue[i])) newIndex++;
    this.queue = this.queue.filter((id) => !gone.has(id));
    if (this.original) this.original = this.original.filter((id) => !gone.has(id));
    if (!this.queue.length) { this.stop(); return; }
    if (curGone) {
      this.index = Math.min(newIndex, this.queue.length - 1);
      this.load(wasPlaying);
    } else {
      this.index = this.queue.indexOf(cur);
    }
    this.emit('queue');
    this.save(true);
  }

  // ---------- Event mesin ----------
  onState() {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = this.current ? (this.isPlaying ? 'playing' : 'paused') : 'none';
    }
    this.emit('state');
  }

  onTime() {
    const t = this.media.currentTime;
    const d = this.duration;
    if (!this.counted && this.current && t >= Math.min(10, d ? d / 2 : 10)) {
      this.counted = true;
      store.recordPlay(this.current.id);
    }
    if (t) this.lastPos = t;
    if (Date.now() - this.lastSave > 5000) this.save();
    this.updatePosition();
    this.emit('time');
  }

  onDuration() {
    const s = this.current;
    const d = this.media.duration;
    if (s && Number.isFinite(d) && d > 0 && Math.abs((s.duration || 0) - d) > 1.5) {
      store.updateSong(s.id, { duration: d });
    }
    this.updatePosition(true);
    this.emit('time');
  }

  onEnded() {
    if (this.remote) return; // HP pembuat sesi yang menentukan lagu berikutnya
    if (this.sleep && this.sleep.mode === 'track') {
      this.clearSleep();
      this.media.currentTime = 0;
      this.media.pause();
      this.onState();
      return;
    }
    if (this.repeat === 'one') {
      this.media.currentTime = 0;
      this.safePlay();
      return;
    }
    this.next(true);
  }

  onError(e) {
    const s = this.current;
    if (!s) return;
    if (e && e.target === this.yt) {
      this.fail(`"${s.title}": ${YT_ERRORS[this.yt.errorCode] || 'Video YouTube tidak bisa diputar.'}`);
      return;
    }
    if (!this.audio.getAttribute('src')) return;
    const msg = s.source === 'url'
      ? `Tidak bisa memutar "${s.title}" (link tidak bisa diakses).`
      : `Tidak bisa memutar "${s.title}". Format mungkin tidak didukung.`;
    this.fail(msg);
  }

  fail(msg) {
    this.emit('error', msg);
    if (this.remote) { this.onState(); return; }
    this.errorStreak++;
    if (this.errorStreak < Math.min(5, this.queue.length) && this.queue.length > 1) {
      setTimeout(() => this.next(true), 600);
    } else {
      this.onState();
    }
  }

  // ---------- Timer tidur ----------
  setSleep(value) {
    this.clearSleep(false);
    if (value === 'track') {
      this.sleep = { mode: 'track' };
    } else if (value > 0) {
      const end = Date.now() + value * 60000;
      this.sleep = { mode: 'time', end, timer: setInterval(() => this.checkSleep(), 1000) };
    }
    this.emit('sleep');
  }

  clearSleep(emit = true) {
    if (this.sleep && this.sleep.timer) clearInterval(this.sleep.timer);
    if (this.fading) {
      const v = store.settings.volume ?? 0.8;
      this.audio.volume = v;
      this.yt.volume = v;
      this.fading = false;
    }
    this.sleep = null;
    if (emit) this.emit('sleep');
  }

  sleepRemaining() {
    if (!this.sleep) return null;
    if (this.sleep.mode === 'track') return 'track';
    return Math.max(0, this.sleep.end - Date.now());
  }

  checkSleep() {
    if (!this.sleep || this.sleep.mode !== 'time') return;
    const left = this.sleep.end - Date.now();
    const base = store.settings.volume ?? 0.8;
    if (left <= 0) {
      this.media.pause();
      this.clearSleep();
      return;
    }
    if (left < 10000 && this.isPlaying) {
      this.fading = true;
      this.media.volume = Math.max(0, base * (left / 10000));
    }
    this.emit('sleep');
  }

  // ---------- Media Session (kontrol di layar kunci / notifikasi / headset) ----------
  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* tidak didukung */ } };
    set('play', () => this.play());
    set('pause', () => this.pause());
    set('stop', () => this.pause());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next());
    set('seekbackward', (d) => this.seekBy(-(d.seekOffset || 10)));
    set('seekforward', (d) => this.seekBy(d.seekOffset || 10));
    set('seekto', (d) => {
      if (d.fastSeek && 'fastSeek' in this.media) this.media.fastSeek(d.seekTime);
      else this.seek(d.seekTime);
    });
  }

  async updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const s = this.current;
    if (!s) { navigator.mediaSession.metadata = null; return; }
    const artwork = [];
    const url = await store.coverUrl(s.id);
    if (this.current?.id !== s.id) return;
    if (url) artwork.push({ src: url, sizes: '600x600', type: 'image/jpeg' });
    artwork.push({ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' });
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: s.title,
        artist: s.artist,
        album: s.album || '',
        artwork,
      });
    } catch { /* abaikan */ }
  }

  updatePosition(force = false) {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const now = Date.now();
    if (!force && now - (this.lastPosUpdate || 0) < 1000) return;
    this.lastPosUpdate = now;
    const d = this.media.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: d,
        playbackRate: this.media.playbackRate || 1,
        position: Math.min(d, Math.max(0, this.media.currentTime)),
      });
    } catch { /* abaikan */ }
  }

  // ---------- Mode tamu Dengar Bareng ----------
  enterRemote(remote) {
    this.snapshot = { queue: this.queue.slice(), original: this.original, index: this.index, context: this.context, time: this.time };
    this.token++;
    this.audio.pause();
    this.yt.stop();
    this.remote = remote;
    this.remoteSong = null;
    this.context = { type: 'together', id: null, label: 'Dengar Bareng' };
    this.emit('queue');
    this.emit('track');
    this.onState();
  }

  /** Muat lagu dari sesi (blob dari HP pembuat sesi, atau url). src null = hanya tampilkan info. */
  loadRemote(song, src) {
    const token = ++this.token;
    this.remoteSong = song;
    this.queue = [song.id];
    this.index = 0;
    this.counted = true;
    this.audio.pause();
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
    if (!src) {
      this.audio.removeAttribute('src');
      try { this.audio.load(); } catch { /* abaikan */ }
      this.emit('queue'); this.emit('track'); this.updateMediaSession(); this.onState();
      return Promise.resolve();
    }
    if (src.blob) { this.objectUrl = URL.createObjectURL(src.blob); this.audio.src = this.objectUrl; }
    else this.audio.src = src.url;
    this.emit('queue'); this.emit('track'); this.updateMediaSession(); this.onState();
    return new Promise((resolve) => {
      const done = () => { this.audio.removeEventListener('loadedmetadata', done); this.audio.removeEventListener('error', done); resolve(token === this.token); };
      this.audio.addEventListener('loadedmetadata', done);
      this.audio.addEventListener('error', done);
      setTimeout(done, 8000);
    });
  }

  exitRemote() {
    this.token++;
    this.remote = null;
    this.remoteSong = null;
    this.audio.pause();
    this.audio.playbackRate = 1;
    this.audio.removeAttribute('src');
    try { this.audio.load(); } catch { /* abaikan */ }
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
    const snap = this.snapshot;
    this.snapshot = null;
    this.queue = snap ? snap.queue.filter((id) => store.get(id)) : [];
    this.original = snap && snap.original ? snap.original.filter((id) => store.get(id)) : null;
    this.context = (snap && snap.context) || { type: 'library', id: null, label: 'Semua lagu' };
    this.index = snap ? Math.min(snap.index, this.queue.length - 1) : -1;
    this.emit('queue');
    if (this.index >= 0) this.load(false, snap.time || 0);
    else { this.emit('track'); this.onState(); this.updateMediaSession(); }
  }

  // ---------- Simpan & pulihkan ----------
  save(force = false) {
    if (this.remote) return; // jangan timpa antrean milik sendiri saat jadi tamu
    if (!force && Date.now() - this.lastSave < 2000) return;
    this.lastSave = Date.now();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        queue: this.queue,
        original: this.original,
        index: this.index,
        context: this.context,
        time: (this.isLoaded && this.media.currentTime) || this.lastPos || 0,
      }));
    } catch { /* abaikan */ }
  }

  restore() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { data = null; }
    if (!data || !Array.isArray(data.queue)) return;
    const cur = data.queue[data.index];
    this.queue = data.queue.filter((id) => store.get(id));
    this.original = Array.isArray(data.original) ? data.original.filter((id) => store.get(id)) : null;
    if (this.original && !this.shuffle) this.original = null;
    this.context = data.context || this.context;
    this.index = this.queue.indexOf(cur);
    if (this.index < 0) {
      if (!this.queue.length) return;
      this.index = 0;
      data.time = 0;
    }
    this.emit('queue');
    this.load(false, data.time || 0);
  }
}
