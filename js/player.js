// Mesin pemutar: antrean, acak, ulangi, timer tidur, kontrol layar kunci (Media Session).
import { store } from './store.js';

const SAVE_KEY = 'lagu-playback';

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Player extends EventTarget {
  constructor(audio) {
    super();
    this.audio = audio;
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

    audio.volume = store.settings.volume ?? 0.8;
    audio.muted = !!store.settings.muted;

    audio.addEventListener('play', () => this.onState());
    audio.addEventListener('pause', () => { this.onState(); this.save(); });
    audio.addEventListener('playing', () => { this.errorStreak = 0; this.onState(); });
    audio.addEventListener('ended', () => this.onEnded());
    audio.addEventListener('error', () => this.onError());
    audio.addEventListener('timeupdate', () => this.onTime());
    audio.addEventListener('durationchange', () => this.onDuration());
    audio.addEventListener('volumechange', () => this.emit('volume'));
    audio.addEventListener('seeked', () => this.updatePosition(true));

    store.subscribe((type, detail) => {
      if (type === 'songs-deleted') this.onSongsDeleted(detail);
      else if (type === 'songs') { this.updateMediaSession(); this.emit('track'); }
    });

    this.setupMediaSession();
    window.addEventListener('pagehide', () => this.save(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(true); });
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  get current() { return this.index >= 0 ? store.get(this.queue[this.index]) || null : null; }
  get currentId() { return this.index >= 0 ? this.queue[this.index] : null; }
  get isPlaying() { return !this.audio.paused && !this.audio.ended; }
  get time() { return this.audio.currentTime || 0; }
  get duration() {
    const d = this.audio.duration;
    if (Number.isFinite(d) && d > 0) return d;
    return this.current?.duration || 0;
  }

  // ---------- Memutar ----------
  async playList(ids, start = 0, context = null, opts = {}) {
    ids = ids.filter((id) => store.get(id));
    if (!ids.length) return;
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
      await this.audio.play();
    } catch (err) {
      if (err && err.name === 'NotAllowedError') this.emit('error', 'Ketuk tombol putar untuk mulai memutar.');
      else if (err && err.name !== 'AbortError') console.warn(err);
    }
    this.onState();
  }

  play() {
    if (!this.current) {
      const all = store.all().sort((a, b) => b.addedAt - a.addedAt).map((s) => s.id);
      if (all.length) this.playList(all, this.shuffle ? -1 : 0, { type: 'library', id: null, label: 'Semua lagu' });
      return;
    }
    if (!this.audio.getAttribute('src')) { this.load(true, this.lastPos); return; }
    this.safePlay();
  }

  pause() { this.audio.pause(); }
  toggle() { if (this.isPlaying) this.pause(); else this.play(); }

  next(auto = false) {
    if (!this.queue.length) return;
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
    if (!this.queue.length) return;
    if (this.audio.currentTime > 3 || (this.index === 0 && this.repeat !== 'all')) {
      this.audio.currentTime = 0;
      if (!this.isPlaying) this.safePlay();
      return;
    }
    this.index = this.index > 0 ? this.index - 1 : this.queue.length - 1;
    this.load(true);
  }

  seek(t) {
    const d = this.duration;
    if (!d) return;
    try { this.audio.currentTime = Math.max(0, Math.min(d - 0.05, t)); } catch { /* abaikan */ }
  }
  seekBy(delta) { this.seek(this.audio.currentTime + delta); }

  setVolume(v) {
    v = Math.max(0, Math.min(1, v));
    this.audio.volume = v;
    if (v > 0 && this.audio.muted) this.audio.muted = false;
    store.saveSettings({ volume: v, muted: this.audio.muted });
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    if (!this.audio.muted && this.audio.volume === 0) this.audio.volume = 0.5;
    store.saveSettings({ muted: this.audio.muted, volume: this.audio.volume });
  }

  toggleShuffle() {
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
        let q = this.original.filter((id) => store.get(id));
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
    this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
    store.saveSettings({ repeat: this.repeat });
    this.emit('modes');
  }

  // ---------- Antrean ----------
  playNext(ids) {
    ids = ids.filter((id) => store.get(id));
    if (!ids.length) return;
    if (!this.queue.length) { this.playList(ids, 0, { type: 'queue', id: null, label: 'Antrean' }); return; }
    this.queue.splice(this.index + 1, 0, ...ids);
    if (this.original) this.original.push(...ids);
    this.emit('queue');
    this.save(true);
  }

  addToQueue(ids) {
    ids = ids.filter((id) => store.get(id));
    if (!ids.length) return;
    if (!this.queue.length) { this.playList(ids, 0, { type: 'queue', id: null, label: 'Antrean' }); return; }
    this.queue.push(...ids);
    if (this.original) this.original.push(...ids);
    this.emit('queue');
    this.save(true);
  }

  jumpTo(i) {
    if (i < 0 || i >= this.queue.length) return;
    this.index = i;
    this.load(true);
  }

  removeAt(i) {
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

  onSongsDeleted(ids) {
    if (!this.queue.length) return;
    const gone = new Set(ids);
    const cur = this.currentId;
    const curGone = cur && gone.has(cur);
    const wasPlaying = this.isPlaying;
    // posisi lagu sekarang setelah lagu-lagu sebelumnya dihapus
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

  // ---------- Event audio ----------
  onState() {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = this.current ? (this.isPlaying ? 'playing' : 'paused') : 'none';
    }
    this.emit('state');
  }

  onTime() {
    const t = this.audio.currentTime;
    const d = this.duration;
    if (!this.counted && this.current && t >= Math.min(10, d ? d / 2 : 10)) {
      this.counted = true;
      store.recordPlay(this.current.id);
    }
    this.lastPos = t;
    if (Date.now() - this.lastSave > 5000) this.save();
    this.updatePosition();
  }

  onDuration() {
    const s = this.current;
    const d = this.audio.duration;
    if (s && Number.isFinite(d) && d > 0 && Math.abs((s.duration || 0) - d) > 1.5) {
      store.updateSong(s.id, { duration: d });
    }
    this.updatePosition(true);
  }

  onEnded() {
    if (this.sleep && this.sleep.mode === 'track') {
      this.clearSleep();
      this.audio.currentTime = 0;
      this.onState();
      return;
    }
    if (this.repeat === 'one') {
      this.audio.currentTime = 0;
      this.safePlay();
      return;
    }
    this.next(true);
  }

  onError() {
    if (!this.audio.getAttribute('src')) return;
    const s = this.current;
    const msg = s && s.source === 'url'
      ? `Tidak bisa memutar "${s.title}" (link tidak bisa diakses).`
      : `Tidak bisa memutar "${s ? s.title : 'lagu'}". Format mungkin tidak didukung.`;
    this.fail(msg);
  }

  fail(msg) {
    this.emit('error', msg);
    this.errorStreak++;
    if (this.errorStreak < Math.min(5, this.queue.length) && this.queue.length > 1) {
      setTimeout(() => this.next(true), 400);
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
      this.audio.volume = store.settings.volume ?? 0.8;
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
      this.audio.pause();
      this.clearSleep();
      return;
    }
    if (left < 10000 && this.isPlaying) {
      this.fading = true;
      this.audio.volume = Math.max(0, base * (left / 10000));
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
      if (d.fastSeek && 'fastSeek' in this.audio) this.audio.fastSeek(d.seekTime);
      else this.seek(d.seekTime);
    });
  }

  async updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const s = this.current;
    if (!s) { navigator.mediaSession.metadata = null; return; }
    const artwork = [];
    const url = await store.coverUrl(s.id);
    if (s !== this.current && this.current?.id !== s.id) return;
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
    const d = this.audio.duration;
    if (!Number.isFinite(d) || d <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: d,
        playbackRate: this.audio.playbackRate || 1,
        position: Math.min(d, Math.max(0, this.audio.currentTime)),
      });
    } catch { /* abaikan */ }
  }

  // ---------- Simpan & pulihkan ----------
  save(force = false) {
    if (!force && Date.now() - this.lastSave < 2000) return;
    this.lastSave = Date.now();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        queue: this.queue,
        original: this.original,
        index: this.index,
        context: this.context,
        time: this.audio.currentTime || this.lastPos || 0,
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
    this.lastPos = data.time || 0;
    this.emit('queue');
    this.load(false, this.lastPos);
  }
}
