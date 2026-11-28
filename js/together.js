// Dengar Bareng: memutar lagu yang sama di beberapa HP secara bersamaan.
// - HP pembuat sesi ("host") memilih & mengatur lagu.
// - HP teman ("tamu") tersambung langsung (WebRTC lewat PeerJS), menerima file lagu
//   sementara (tidak disimpan ke pustakanya), lalu memutar di detik yang sama.
//
// Ketahanan koneksi:
// - Dua jalur terpisah: "ctrl" (status, jam, perintah) dan "file" (kiriman lagu), supaya
//   perintah tidak tertahan di belakang file yang sedang dikirim.
// - Host mengirim status tiap 2 detik; tamu memantau, dan bila sambungan putus/macet
//   tamu menyambung ulang otomatis sambil TETAP memutar lagu.
import { store } from './store.js';
import { fingerprint } from './importer.js';
import * as db from './db.js';

const PREFIX = 'lagu-syarafat-';
const CHUNK = 64 * 1024;
const MAX_CACHE = 4;
const HEARTBEAT_MS = 2000;
const STALE_MS = 9000; // tidak ada kabar dari host selama ini → anggap macet
const GUEST_GRACE_MS = 90000; // host menunggu tamu yang terputus sebelum menghapusnya
const RECONNECT_WINDOW_MS = 3 * 60 * 1000;
const now = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => Math.random().toString(36).slice(2, 10);

let peerLib = null;
function loadPeerLib() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (!peerLib) {
    peerLib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('vendor/peerjs.min.js', import.meta.url).href;
      s.onload = () => resolve(window.Peer);
      s.onerror = () => { peerLib = null; s.remove(); reject(new Error('Gagal memuat modul Dengar Bareng. Periksa koneksi internet.')); };
      document.head.appendChild(s);
    });
  }
  return peerLib;
}

function friendlyError(err) {
  const t = err && err.type;
  if (t === 'peer-unavailable') return 'Kode tidak ditemukan. Pastikan kodenya benar dan HP pembuat sesi masih membuka aplikasi.';
  if (t === 'browser-incompatible') return 'Browser ini tidak mendukung Dengar Bareng. Coba pakai Chrome versi terbaru.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed' || t === 'disconnected') return 'Tidak bisa terhubung. Periksa koneksi internet kedua HP.';
  if (err && err.message === 'timeout') return 'Tidak ada jawaban dari HP pembuat sesi. Coba lagi.';
  return (err && err.message) || 'Terjadi kesalahan pada Dengar Bareng.';
}

function openPeer(Peer, id) {
  return new Promise((resolve, reject) => {
    const p = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
    const t = setTimeout(() => { p.destroy(); reject(Object.assign(new Error('timeout'), { type: 'network' })); }, 15000);
    p.once('open', () => { clearTimeout(t); resolve(p); });
    p.once('error', (e) => { clearTimeout(t); p.destroy(); reject(e); });
  });
}

/** Tunggu koneksi data terbuka (atau gagal). */
function waitOpen(conn, peer, ms) {
  return new Promise((resolve, reject) => {
    if (conn.open) { resolve(); return; }
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      peer.off('error', onPeerErr);
      fn(v);
    };
    const onPeerErr = (e) => { if (e.type === 'peer-unavailable' || e.type === 'network' || e.type === 'disconnected') finish(reject, e); };
    const t = setTimeout(() => finish(reject, new Error('timeout')), ms);
    conn.once('open', () => finish(resolve));
    conn.once('error', (e) => finish(reject, e));
    conn.once('close', () => finish(reject, new Error('closed')));
    peer.on('error', onPeerErr);
  });
}

class Together extends EventTarget {
  constructor() {
    super();
    this.mode = 'idle'; // idle | connecting | host | guest
    this.player = null;
    this.peer = null;
    this.code = '';
    this.myName = '';
    this.wakeLock = null;
    // host
    this.guests = new Map(); // gid -> { gid, name, ctrl, file, status, chain, goneTimer }
    this.seq = 0;
    this.heartbeat = 0;
    this.bcTimer = 0;
    this.hostListeners = null;
    // tamu
    this.gid = '';
    this.ctrl = null;
    this.fileConn = null;
    this.hostName = '';
    this.offset = 0;
    this.clockSamples = [];
    this.state = null;
    this.cache = new Map(); // key -> { blob, cover }
    this.requested = new Set();
    this.incoming = null;
    this.remoteKey = null;
    this.loadedKey = null;
    this.loadingKey = null;
    this.metaShown = false;
    this.ready = false;
    this.recvPct = 0;
    this.drift = 0;
    this.needTap = false;
    this.reconnecting = false;
    this.reconnectStarted = 0;
    this.lastMsgAt = 0;
    this.syncTimer = 0;
    this.clockTimer = 0;
    this.watchTimer = 0;
    this.lastStatus = '';
    document.addEventListener('visibilitychange', () => this.onVisible());
  }

  init(player) { this.player = player; }
  get delayMs() { return store.settings.togetherDelay || 0; }
  setDelay(ms) {
    store.saveSettings({ togetherDelay: Math.max(-2000, Math.min(2000, Math.round(ms))) });
    this.syncPlayback(true);
    this.changed();
  }

  changed() { this.dispatchEvent(new Event('change')); }
  info(msg, kind = '') { this.dispatchEvent(new CustomEvent('info', { detail: { msg, kind } })); }

  // ---------- Layar tetap menyala (opsional, agar HP tidak "tidur") ----------
  get keepAwake() { return !!store.settings.togetherAwake; }
  async setKeepAwake(on) {
    store.saveSettings({ togetherAwake: !!on });
    await this.applyWakeLock();
    this.changed();
  }
  async applyWakeLock() {
    const want = this.keepAwake && this.mode !== 'idle' && !document.hidden;
    if (want && !this.wakeLock && navigator.wakeLock) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
      } catch { this.wakeLock = null; }
    } else if (!want && this.wakeLock) {
      try { await this.wakeLock.release(); } catch { /* abaikan */ }
      this.wakeLock = null;
    }
  }

  onVisible() {
    if (document.hidden) return;
    this.applyWakeLock();
    if (this.mode === 'guest') {
      if (!this.ctrl || !this.ctrl.open || now() - this.lastMsgAt > STALE_MS) this.reconnect('kembali ke aplikasi');
      this.syncPlayback(true);
    }
    if (this.mode === 'host' && this.peer && this.peer.disconnected && !this.peer.destroyed) this.peer.reconnect();
  }

  // ================= HOST =================
  async host(name) {
    if (this.mode !== 'idle') return;
    this.myName = name || 'Teman';
    this.mode = 'connecting';
    this.changed();
    try {
      const Peer = await loadPeerLib();
      let lastErr = null;
      for (let i = 0; i < 5 && !this.peer; i++) {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        try {
          this.peer = await openPeer(Peer, PREFIX + code);
          this.code = code;
        } catch (e) {
          lastErr = e;
          if (e.type !== 'unavailable-id') throw e;
        }
      }
      if (!this.peer) throw lastErr || new Error('Gagal membuat sesi.');
    } catch (e) {
      this.mode = 'idle';
      this.peer = null;
      this.changed();
      throw new Error(friendlyError(e));
    }
    this.mode = 'host';
    this.peer.on('connection', (conn) => this.onIncoming(conn));
    // Tetap tersambung ke server agar tamu bisa (menyambung ulang) masuk
    this.peer.on('disconnected', () => { setTimeout(() => { if (this.mode === 'host' && this.peer && this.peer.disconnected && !this.peer.destroyed) this.peer.reconnect(); }, 1000); });
    this.peer.on('error', (e) => { if (e.type !== 'peer-unavailable') console.warn('Dengar Bareng:', e.type || e); });

    const p = this.player;
    const soon = () => this.broadcastSoon();
    this.hostListeners = { soon };
    p.addEventListener('track', soon);
    p.addEventListener('state', soon);
    p.addEventListener('queue', soon);
    p.audio.addEventListener('seeked', soon);
    p.yt.addEventListener('seeked', soon);
    this.heartbeat = setInterval(() => this.broadcast(), HEARTBEAT_MS);
    this.applyWakeLock();
    this.changed();
  }

  onIncoming(conn) {
    const meta = conn.metadata || {};
    const gid = String(meta.gid || conn.peer);
    const label = conn.label === 'file' ? 'file' : 'ctrl';
    conn.on('open', () => {
      let g = this.guests.get(gid);
      const isNew = !g;
      if (isNew) {
        const active = [...this.guests.values()].filter((x) => x.ctrl && x.ctrl.open).length;
        if (label === 'ctrl' && active >= 6) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); return; }
        g = { gid, name: String(meta.name || 'Teman').slice(0, 40), ctrl: null, file: null, status: 'Terhubung', chain: Promise.resolve(), goneTimer: 0 };
        this.guests.set(gid, g);
      }
      clearTimeout(g.goneTimer);
      g.goneTimer = 0;
      const old = g[label];
      g[label] = conn;
      if (old && old !== conn) { try { old.close(); } catch { /* abaikan */ } }
      if (label === 'ctrl') {
        const wasAway = !isNew && g.status === 'Terputus — menunggu…';
        g.status = 'Terhubung';
        conn.send({ t: 'hello', name: this.myName });
        this.sendState(conn);
        if (isNew) this.info(`${g.name} bergabung`);
        else if (wasAway) this.info(`${g.name} tersambung kembali`);
      }
      this.changed();
    });
    conn.on('data', (d) => this.onHostData(gid, d));
    const gone = () => {
      const g = this.guests.get(gid);
      if (!g || g[label] !== conn) return; // koneksi lama yang sudah diganti
      g[label] = null;
      if (label !== 'ctrl') return;
      if (g.left) { this.removeGuest(gid, true); return; }
      // Mungkin cuma terputus sebentar: tunggu tamu menyambung ulang
      g.status = 'Terputus — menunggu…';
      clearTimeout(g.goneTimer);
      g.goneTimer = setTimeout(() => this.removeGuest(gid, true), GUEST_GRACE_MS);
      this.changed();
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  removeGuest(gid, announce) {
    const g = this.guests.get(gid);
    if (!g) return;
    clearTimeout(g.goneTimer);
    for (const c of [g.ctrl, g.file]) { try { c && c.close(); } catch { /* abaikan */ } }
    this.guests.delete(gid);
    if (announce && this.mode === 'host') this.info(`${g.name} keluar dari sesi`);
    this.changed();
  }

  onHostData(gid, d) {
    if (!d || typeof d !== 'object') return;
    const g = this.guests.get(gid);
    if (!g) return;
    switch (d.t) {
      case 'ping': if (g.ctrl && g.ctrl.open) g.ctrl.send({ t: 'pong', a: d.a, h: now() }); break;
      case 'need': g.chain = g.chain.then(() => this.sendFile(g, d.key)).catch((e) => console.warn(e)); break;
      case 'status': g.status = String(d.s || '').slice(0, 60); this.changed(); break;
      case 'cmd': this.applyCommand(d, g); break;
      case 'leave': g.left = true; this.removeGuest(gid, true); break;
      default: break;
    }
  }

  applyCommand(d, g) {
    const p = this.player;
    if (d.c === 'play') p.play();
    else if (d.c === 'pause') p.pause();
    else if (d.c === 'next') p.next();
    else if (d.c === 'prev') p.prev();
    else if (d.c === 'seek' && Number.isFinite(d.v)) p.seek(d.v);
    else return;
    if (g && (d.c === 'next' || d.c === 'prev')) this.info(`${g.name} mengganti lagu`);
  }

  async songKey(s) {
    if (!s) return null;
    if (s.source === 'youtube') return `yt:${s.ytId}`;
    if (s.source === 'url') return `url:${s.url}`;
    if (s.audioHash) return s.audioHash;
    const blob = await store.audioBlob(s.id).catch(() => null);
    const h = blob ? await fingerprint(blob) : null;
    if (!h) return `id:${s.id}`;
    const patch = { audioHash: h };
    if (!s.convertedFrom && !s.srcHash) patch.srcHash = h;
    await store.patchSilently(s.id, patch);
    return h;
  }

  async songMeta(s) {
    if (!s) return null;
    const key = await this.songKey(s);
    return {
      key,
      title: s.title,
      artist: s.artist,
      album: s.album || '',
      duration: s.duration || 0,
      color: s.color,
      url: s.source === 'url' ? s.url : undefined,
      unsupported: s.source === 'youtube' || undefined,
    };
  }

  async buildState() {
    const p = this.player;
    const cur = p.current;
    const next = p.queue[p.index + 1] ? store.get(p.queue[p.index + 1]) : null;
    const [song, nextMeta] = await Promise.all([this.songMeta(cur), this.songMeta(next)]);
    return { t: 'state', seq: ++this.seq, song, next: nextMeta, playing: p.isPlaying, pos: p.time, at: now() };
  }

  async sendState(conn) {
    try { const st = await this.buildState(); if (conn.open) conn.send(st); } catch (e) { console.warn(e); }
  }

  broadcastSoon() {
    clearTimeout(this.bcTimer);
    this.bcTimer = setTimeout(() => this.broadcast(), 60);
  }

  async broadcast() {
    if (this.mode !== 'host' || !this.guests.size) return;
    let st;
    try { st = await this.buildState(); } catch (e) { console.warn(e); return; }
    for (const g of this.guests.values()) if (g.ctrl && g.ctrl.open) g.ctrl.send(st);
  }

  findSongByKey(key) {
    if (!key) return null;
    if (key.startsWith('id:')) return store.get(key.slice(3));
    return store.all().find((s) => s.audioHash === key) || null;
  }

  async sendFile(g, key) {
    // Kirim lewat jalur file; bila belum ada, tunggu sebentar lalu pakai jalur ctrl
    for (let i = 0; i < 20 && !(g.file && g.file.open) && g.ctrl && g.ctrl.open; i++) await sleep(100);
    const conn = (g.file && g.file.open) ? g.file : g.ctrl;
    if (!conn || !conn.open) return;
    const s = this.findSongByKey(key);
    const blob = s ? await store.audioBlob(s.id).catch(() => null) : null;
    if (!blob) { conn.send({ t: 'file-missing', key }); return; }
    let cover = null;
    if (s.hasCover && !s.remoteCover) {
      const c = await db.get('covers', s.id).catch(() => null);
      if (c) cover = { buf: await c.arrayBuffer(), mime: c.type || 'image/jpeg' };
    }
    const id = rid();
    conn.send({ t: 'file-start', id, key, size: blob.size, mime: blob.type || 'audio/mpeg', cover: cover ? cover.buf : null, coverMime: cover ? cover.mime : null });
    for (let o = 0; o < blob.size; o += CHUNK) {
      if (!conn.open) return;
      const dc = conn.dataChannel;
      while (conn.open && ((dc && dc.bufferedAmount > 1024 * 1024) || conn.bufferSize > 16)) await sleep(20);
      conn.send({ t: 'chunk', id, key, d: await blob.slice(o, o + CHUNK).arrayBuffer() });
    }
    if (conn.open) conn.send({ t: 'file-end', id, key });
  }

  // ================= TAMU =================
  async join(rawCode, name) {
    if (this.mode !== 'idle') return;
    const code = String(rawCode || '').replace(/\D/g, '');
    if (code.length !== 6) throw new Error('Kode sesi harus 6 angka.');
    this.myName = name || 'Teman';
    this.gid = `${rid()}${rid()}`;
    this.code = code;
    this.mode = 'connecting';
    this.changed();
    try {
      await this.connectToHost(20000);
    } catch (e) {
      this.closeConns();
      if (this.peer) this.peer.destroy();
      this.peer = null;
      this.mode = 'idle';
      this.code = '';
      this.changed();
      throw new Error(friendlyError(e));
    }
    this.mode = 'guest';
    this.state = null;
    this.remoteKey = null;
    this.loadedKey = null;
    this.loadingKey = null;
    this.metaShown = false;
    this.ready = false;
    this.offset = 0;
    this.clockSamples = [];
    this.player.enterRemote({ command: (c) => this.sendCommand(c) });
    this.syncClock(6);
    this.clockTimer = setInterval(() => this.syncClock(2), 10000);
    this.syncTimer = setInterval(() => this.syncPlayback(), 400);
    this.watchTimer = setInterval(() => this.watchdog(), 2000);
    this.applyWakeLock();
    this.changed();
  }

  /** Buka (atau buka ulang) jalur ctrl & file ke host. */
  async connectToHost(timeout) {
    const Peer = await loadPeerLib();
    if (!this.peer || this.peer.destroyed) {
      this.peer = await openPeer(Peer, null);
      this.peer.on('error', (e) => { if (e.type !== 'peer-unavailable') console.warn('Dengar Bareng:', e.type || e); });
      this.peer.on('disconnected', () => {
        setTimeout(() => { if (this.mode === 'guest' && this.peer && this.peer.disconnected && !this.peer.destroyed) this.peer.reconnect(); }, 1000);
      });
    } else if (this.peer.disconnected) {
      this.peer.reconnect();
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(Object.assign(new Error('timeout'), { type: 'network' })), 8000);
        this.peer.once('open', () => { clearTimeout(t); resolve(); });
      });
    }
    const metadata = { name: this.myName, gid: this.gid };
    const ctrl = this.peer.connect(PREFIX + this.code, { label: 'ctrl', reliable: true, metadata });
    this.bindConn(ctrl, 'ctrl');
    await waitOpen(ctrl, this.peer, timeout);
    this.ctrl = ctrl;
    this.lastMsgAt = now();
    // Jalur file dibuka setelahnya (tidak wajib: bila gagal, file lewat jalur ctrl)
    const file = this.peer.connect(PREFIX + this.code, { label: 'file', reliable: true, metadata });
    this.bindConn(file, 'file');
    waitOpen(file, this.peer, timeout).then(() => { if (this.mode !== 'idle') this.fileConn = file; }).catch(() => {});
  }

  bindConn(conn, label) {
    conn.on('data', (d) => { if (label === 'ctrl') this.lastMsgAt = now(); this.onGuestData(d); });
    const gone = () => {
      if (label === 'ctrl' && conn === this.ctrl && this.mode === 'guest') this.reconnect('sambungan terputus');
      if (label === 'file' && conn === this.fileConn) this.fileConn = null;
    };
    conn.on('close', gone);
    conn.on('error', gone);
    conn.on('iceStateChanged', (s) => { if ((s === 'failed' || s === 'closed') && conn === this.ctrl) gone(); });
  }

  closeConns() {
    for (const c of [this.ctrl, this.fileConn]) { try { c && c.close(); } catch { /* abaikan */ } }
    this.ctrl = null;
    this.fileConn = null;
  }

  watchdog() {
    if (this.mode !== 'guest' || this.reconnecting) return;
    if (!this.ctrl || !this.ctrl.open || now() - this.lastMsgAt > STALE_MS) this.reconnect('tidak ada kabar dari host');
  }

  /** Sambung ulang otomatis; lagu tetap diputar selama proses ini. */
  async reconnect(reason) {
    if (this.mode !== 'guest' || this.reconnecting) return;
    this.reconnecting = true;
    this.reconnectStarted = now();
    console.info('Dengar Bareng: menyambung ulang —', reason);
    this.closeConns();
    // kiriman file yang terpotong harus diminta ulang
    if (this.incoming) { this.requested.delete(this.incoming.key); this.incoming = null; }
    this.requested.clear();
    this.changed();
    const delays = [500, 1500, 3000, 5000, 8000, 10000];
    for (let i = 0; this.mode === 'guest'; i++) {
      if (now() - this.reconnectStarted > RECONNECT_WINDOW_MS) {
        this.reconnecting = false;
        this.leave('Koneksi ke sesi terputus terlalu lama. Silakan gabung lagi.');
        return;
      }
      await sleep(delays[Math.min(i, delays.length - 1)]);
      if (this.mode !== 'guest') return;
      try {
        await this.connectToHost(10000);
        this.reconnecting = false;
        this.clockSamples = [];
        this.syncClock(5);
        this.info('Tersambung kembali');
        if (this.state && this.state.song && this.loadedKey !== this.state.song.key) this.handleState();
        this.changed();
        return;
      } catch (e) {
        if (e && e.type === 'peer-unavailable' && now() - this.reconnectStarted > 60000) {
          // Host tidak ditemukan selama 1 menit: kemungkinan aplikasinya ditutup
          this.reconnecting = false;
          this.leave('Sesi tidak ditemukan lagi — mungkin HP pembuat sesi menutup aplikasinya.');
          return;
        }
        if (this.peer && !this.peer.destroyed && (e && (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error'))) {
          try { this.peer.destroy(); } catch { /* abaikan */ }
          this.peer = null;
        }
      }
    }
  }

  sendCommand(c) {
    if (this.ctrl && this.ctrl.open) this.ctrl.send({ t: 'cmd', ...c });
    else this.info('Sedang menyambung ulang… coba lagi sebentar.', 'warn');
  }

  async syncClock(n = 5) {
    for (let i = 0; i < n && this.mode === 'guest'; i++) {
      if (this.ctrl && this.ctrl.open) this.ctrl.send({ t: 'ping', a: now() });
      await sleep(120);
    }
  }

  addClockSample(a, h) {
    const b = now();
    const rtt = b - a;
    if (rtt < 0 || rtt > 5000) return;
    this.clockSamples.push({ rtt, off: h - (a + b) / 2, at: b });
    this.clockSamples = this.clockSamples.filter((x) => b - x.at < 90000).slice(-30);
    // pakai sampel dengan waktu tempuh tercepat (paling akurat)
    const best = this.clockSamples.reduce((m, x) => (x.rtt < m.rtt ? x : m));
    this.offset = best.off;
  }

  reportStatus(s) {
    if (s === this.lastStatus || !this.ctrl || !this.ctrl.open) return;
    this.lastStatus = s;
    this.ctrl.send({ t: 'status', s });
  }

  onGuestData(d) {
    if (!d || typeof d !== 'object') return;
    switch (d.t) {
      case 'hello': {
        const first = !this.hostName;
        this.hostName = String(d.name || 'Teman').slice(0, 40);
        if (first) this.info(`Tersambung dengan ${this.hostName}`);
        this.lastStatus = '';
        this.changed();
        break;
      }
      case 'pong': this.addClockSample(d.a, d.h); break;
      case 'state':
        if (!this.state || d.seq > this.state.seq || d.seq < this.state.seq - 50) { this.state = d; this.handleState(); }
        break;
      case 'file-start':
        this.incoming = { id: d.id, key: d.key, size: d.size, mime: d.mime, parts: [], got: 0, cover: d.cover ? new Blob([d.cover], { type: d.coverMime || 'image/jpeg' }) : null };
        this.recvPct = 0;
        this.changed();
        break;
      case 'chunk':
        if (this.incoming && this.incoming.id === d.id && d.d) {
          this.incoming.parts.push(d.d);
          this.incoming.got += d.d.byteLength;
          const pct = Math.floor((this.incoming.got / this.incoming.size) * 100);
          if (pct >= this.recvPct + 5) {
            this.recvPct = pct;
            if (this.state && this.state.song && this.state.song.key === d.key) this.reportStatus(`Menerima lagu ${pct}%`);
            this.changed();
          }
        }
        break;
      case 'file-end':
        if (this.incoming && this.incoming.id === d.id) {
          const inc = this.incoming;
          this.incoming = null;
          if (inc.got >= inc.size) {
            this.cache.set(inc.key, { blob: new Blob(inc.parts, { type: inc.mime }), cover: inc.cover });
            while (this.cache.size > MAX_CACHE) {
              const keep = this.state && this.state.song && this.state.song.key;
              const oldest = [...this.cache.keys()].find((k) => k !== keep);
              this.cache.delete(oldest);
            }
          }
          this.requested.delete(inc.key);
          if (this.state && this.state.song && this.state.song.key === inc.key) this.handleState();
          else this.requestNext();
          this.changed();
        }
        break;
      case 'file-missing': this.requested.delete(d.key); break;
      case 'full': this.leave('Sesi sudah penuh (maks. 6 teman).'); break;
      case 'bye': this.leave('Sesi diakhiri oleh pembuat sesi.'); break;
      default: break;
    }
  }

  findLocal(key) {
    return store.all().find((s) => s.audioHash === key || (!s.convertedFrom && s.srcHash === key)) || null;
  }

  requestFile(key) {
    if (this.requested.has(key) || this.cache.has(key) || !this.ctrl || !this.ctrl.open) return;
    this.requested.add(key);
    this.ctrl.send({ t: 'need', key });
  }

  requestNext() {
    const n = this.state && this.state.next;
    if (!n || n.url || n.unsupported || this.incoming) return;
    if (this.cache.has(n.key) || this.findLocal(n.key)) return;
    this.requestFile(n.key);
  }

  async handleState() {
    const st = this.state;
    const s = st && st.song;
    if (!s) {
      this.ready = false;
      this.player.audio.pause();
      this.reportStatus('Menunggu lagu');
      this.changed();
      return;
    }
    if (s.key !== this.remoteKey) {
      this.remoteKey = s.key;
      this.loadedKey = null;
      this.metaShown = false;
      this.ready = false;
    }
    if (this.loadedKey !== s.key) {
      if (this.loadingKey === s.key) return;
      const meta = { id: `remote:${s.key}`, title: s.title, artist: s.artist, album: s.album, duration: s.duration, color: s.color, hasCover: false, source: 'remote' };
      if (s.unsupported) {
        if (!this.metaShown) {
          this.metaShown = true;
          await this.player.loadRemote(meta, null);
          this.info('Lagu YouTube tidak bisa diputar bersama. Tunggu lagu berikutnya.', 'warn');
          this.reportStatus('Lagu tidak didukung');
          this.changed();
        }
        return;
      }
      let src = null;
      let cover = null;
      const local = this.findLocal(s.key);
      if (s.url) src = { url: s.url };
      else if (local) {
        const blob = await store.audioBlob(local.id).catch(() => null);
        if (blob) src = { blob };
        if (local.hasCover) {
          const u = await store.coverUrl(local.id);
          if (u) { meta.hasCover = true; store.registerTempCover(meta.id, u); }
        }
      } else if (this.cache.has(s.key)) {
        const c = this.cache.get(s.key);
        src = { blob: c.blob };
        cover = c.cover;
      }
      if (cover) {
        meta.hasCover = true;
        if (!store.coverUrlSync(meta.id)) store.registerTempCover(meta.id, URL.createObjectURL(cover));
      }
      if (this.remoteKey !== s.key) return;
      if (!src) {
        if (!this.metaShown) {
          this.metaShown = true;
          await this.player.loadRemote(meta, null);
        }
        this.requestFile(s.key);
        this.reportStatus(`Menerima lagu ${this.recvPct || 0}%`);
        this.changed();
        return;
      }
      this.loadingKey = s.key;
      try {
        await this.player.loadRemote(meta, src);
      } finally {
        this.loadingKey = null;
      }
      if (this.remoteKey !== s.key) return;
      this.loadedKey = s.key;
      this.ready = true;
      this.reportStatus('Tersinkron');
    }
    this.syncPlayback(true);
    this.requestNext();
    this.changed();
  }

  /** Samakan posisi lagu dengan HP pembuat sesi (juga saat sedang menyambung ulang). */
  syncPlayback(force = false) {
    if (this.mode !== 'guest' || !this.ready) return;
    const st = this.state;
    const a = this.player.audio;
    if (!st || !st.song || a.readyState < 1) return;
    const hostNow = now() + this.offset;
    const dur = Number.isFinite(a.duration) ? a.duration : 0;
    let target = st.pos + (st.playing ? (hostNow - st.at) / 1000 : 0) - this.delayMs / 1000;
    if (target < 0) target = 0;
    if (st.playing && dur && target >= dur - 0.05) {
      // Lagu sudah selesai menurut perkiraan: tunggu host memutar lagu berikutnya
      if (!a.paused && a.currentTime >= dur - 0.3) return;
      target = dur - 0.05;
    }
    const diff = a.currentTime - target;
    this.drift = diff;
    if (!st.playing) {
      if (!a.paused) a.pause();
      a.playbackRate = 1;
      if (Math.abs(diff) > 0.25 || force) { try { a.currentTime = target; } catch { /* abaikan */ } }
      return;
    }
    if (a.paused) {
      if (a.ended || (dur && target >= dur - 0.06)) return;
      try { a.currentTime = target + 0.08; } catch { /* abaikan */ }
      a.play().then(() => { if (this.needTap) { this.needTap = false; this.changed(); } }).catch(() => { if (!this.needTap) { this.needTap = true; this.changed(); } });
      return;
    }
    if (Math.abs(diff) > 0.3) {
      try { a.currentTime = target + 0.06; } catch { /* abaikan */ }
      a.playbackRate = 1;
    } else if (Math.abs(diff) > 0.04) {
      a.playbackRate = diff > 0 ? 0.96 : 1.04; // menyusul pelan-pelan tanpa terdengar lompat
    } else if (a.playbackRate !== 1) {
      a.playbackRate = 1;
    }
  }

  /** Dipanggil dari ketukan pengguna bila browser menahan pemutaran otomatis. */
  resumeAudio() {
    this.needTap = false;
    const a = this.player.audio;
    a.play().catch(() => { this.needTap = true; this.changed(); });
    this.syncPlayback(true);
    this.changed();
  }

  // ================= KELUAR =================
  leave(reason = '') {
    const wasGuest = this.mode === 'guest' || (this.mode === 'connecting' && this.gid);
    const wasHost = this.mode === 'host';
    if (this.mode === 'idle') return;
    clearInterval(this.syncTimer);
    clearInterval(this.clockTimer);
    clearInterval(this.watchTimer);
    clearInterval(this.heartbeat);
    clearTimeout(this.bcTimer);
    if (wasHost) {
      for (const g of this.guests.values()) {
        clearTimeout(g.goneTimer);
        try { if (g.ctrl && g.ctrl.open) g.ctrl.send({ t: 'bye' }); } catch { /* abaikan */ }
      }
      const p = this.player;
      const l = this.hostListeners;
      if (l) {
        p.removeEventListener('track', l.soon);
        p.removeEventListener('state', l.soon);
        p.removeEventListener('queue', l.soon);
        p.audio.removeEventListener('seeked', l.soon);
        p.yt.removeEventListener('seeked', l.soon);
      }
      this.hostListeners = null;
    }
    if (wasGuest && this.ctrl && this.ctrl.open) { try { this.ctrl.send({ t: 'leave' }); } catch { /* abaikan */ } }
    const peer = this.peer;
    const conns = [this.ctrl, this.fileConn];
    setTimeout(() => {
      conns.forEach((c) => { try { c && c.close(); } catch { /* abaikan */ } });
      try { peer && peer.destroy(); } catch { /* abaikan */ }
    }, 400);
    this.peer = null;
    this.ctrl = null;
    this.fileConn = null;
    this.guests.clear();
    this.mode = 'idle';
    this.code = '';
    this.gid = '';
    this.hostName = '';
    this.state = null;
    this.incoming = null;
    this.requested.clear();
    this.cache.clear();
    this.remoteKey = null;
    this.loadedKey = null;
    this.loadingKey = null;
    this.metaShown = false;
    this.ready = false;
    this.needTap = false;
    this.reconnecting = false;
    this.lastStatus = '';
    this.applyWakeLock();
    if (wasGuest && this.player.remote) {
      this.player.audio.playbackRate = 1;
      this.player.exitRemote();
    }
    if (reason) this.info(reason, wasGuest ? 'warn' : '');
    this.changed();
  }
}

export const together = new Together();
window.addEventListener('pagehide', (e) => { if (!e.persisted && together.mode === 'host') together.leave(); });
