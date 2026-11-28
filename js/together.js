// Dengar Bareng: memutar lagu yang sama di beberapa HP secara bersamaan.
// - HP pembuat sesi ("host") memilih & mengatur lagu.
// - HP teman ("tamu") tersambung langsung (WebRTC lewat PeerJS), menerima file lagu
//   sementara (tidak disimpan ke pustakanya), lalu memutar di detik yang sama.
import { store } from './store.js';
import { fingerprint } from './importer.js';
import * as db from './db.js';

const PREFIX = 'lagu-syarafat-';
const CHUNK = 64 * 1024;
const MAX_CACHE = 4;
const now = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

class Together extends EventTarget {
  constructor() {
    super();
    this.mode = 'idle'; // idle | connecting | host | guest
    this.player = null;
    this.peer = null;
    this.code = '';
    this.myName = '';
    // host
    this.guests = new Map(); // peerId -> { conn, name, status, pct, chain }
    this.seq = 0;
    this.heartbeat = 0;
    this.bcTimer = 0;
    this.hostListeners = null;
    // tamu
    this.hostConn = null;
    this.hostName = '';
    this.offset = 0;
    this.bestRtt = Infinity;
    this.state = null;
    this.cache = new Map(); // key -> { blob, cover }
    this.requested = new Set();
    this.incoming = null;
    this.remoteKey = null;
    this.ready = false;
    this.recvPct = 0;
    this.drift = 0;
    this.syncTimer = 0;
    this.clockTimer = 0;
    this.lastStatus = '';
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
    this.peer.on('connection', (conn) => this.onGuestConnection(conn));
    this.peer.on('disconnected', () => { if (this.mode === 'host' && this.peer && !this.peer.destroyed) this.peer.reconnect(); });
    this.peer.on('error', (e) => { if (e.type !== 'peer-unavailable') console.warn('Dengar Bareng:', e); });

    const p = this.player;
    const soon = () => this.broadcastSoon();
    this.hostListeners = { soon };
    p.addEventListener('track', soon);
    p.addEventListener('state', soon);
    p.addEventListener('queue', soon);
    p.audio.addEventListener('seeked', soon);
    p.yt.addEventListener('seeked', soon);
    this.heartbeat = setInterval(() => this.broadcast(), 3000);
    this.changed();
  }

  onGuestConnection(conn) {
    conn.on('open', () => {
      if (this.guests.size >= 6) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); return; }
      const name = String((conn.metadata && conn.metadata.name) || 'Teman').slice(0, 40);
      this.guests.set(conn.peer, { conn, name, status: 'Terhubung', pct: 0, chain: Promise.resolve() });
      conn.send({ t: 'hello', name: this.myName });
      this.sendState(conn);
      this.info(`${name} bergabung`);
      this.changed();
    });
    conn.on('data', (d) => this.onHostData(conn, d));
    const gone = () => {
      const g = this.guests.get(conn.peer);
      if (!g) return;
      this.guests.delete(conn.peer);
      if (this.mode === 'host') this.info(`${g.name} keluar dari sesi`);
      this.changed();
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  onHostData(conn, d) {
    if (!d || typeof d !== 'object') return;
    const g = this.guests.get(conn.peer);
    switch (d.t) {
      case 'ping': conn.send({ t: 'pong', a: d.a, h: now() }); break;
      case 'need': if (g) g.chain = g.chain.then(() => this.sendFile(conn, d.key)).catch((e) => console.warn(e)); break;
      case 'status': if (g) { g.status = String(d.s || '').slice(0, 60); this.changed(); } break;
      case 'cmd': this.applyCommand(d, g); break;
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
    for (const g of this.guests.values()) if (g.conn.open) g.conn.send(st);
  }

  findSongByKey(key) {
    if (!key) return null;
    if (key.startsWith('id:')) return store.get(key.slice(3));
    return store.all().find((s) => s.audioHash === key) || null;
  }

  async sendFile(conn, key) {
    const s = this.findSongByKey(key);
    if (!s || !conn.open) { if (conn.open) conn.send({ t: 'file-missing', key }); return; }
    const blob = await store.audioBlob(s.id);
    if (!blob) { conn.send({ t: 'file-missing', key }); return; }
    let cover = null;
    if (s.hasCover && !s.remoteCover) {
      const c = await db.get('covers', s.id).catch(() => null);
      if (c) cover = { buf: await c.arrayBuffer(), mime: c.type || 'image/jpeg' };
    }
    conn.send({ t: 'file-start', key, size: blob.size, mime: blob.type || 'audio/mpeg', cover: cover ? cover.buf : null, coverMime: cover ? cover.mime : null });
    for (let o = 0; o < blob.size; o += CHUNK) {
      if (!conn.open) return;
      const dc = conn.dataChannel;
      while (conn.open && ((dc && dc.bufferedAmount > 1024 * 1024) || conn.bufferSize > 16)) await sleep(20);
      conn.send({ t: 'chunk', key, d: await blob.slice(o, o + CHUNK).arrayBuffer() });
    }
    conn.send({ t: 'file-end', key });
  }

  // ================= TAMU =================
  async join(rawCode, name) {
    if (this.mode !== 'idle') return;
    const code = String(rawCode || '').replace(/\D/g, '');
    if (code.length !== 6) throw new Error('Kode sesi harus 6 angka.');
    this.myName = name || 'Teman';
    this.mode = 'connecting';
    this.changed();
    let conn;
    try {
      const Peer = await loadPeerLib();
      this.peer = await openPeer(Peer, null);
      conn = this.peer.connect(PREFIX + code, { reliable: true, metadata: { name: this.myName } });
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 20000);
        conn.once('open', () => { clearTimeout(t); resolve(); });
        this.peer.once('error', (e) => { clearTimeout(t); reject(e); });
        conn.once('error', (e) => { clearTimeout(t); reject(e); });
      });
    } catch (e) {
      if (this.peer) this.peer.destroy();
      this.peer = null;
      this.mode = 'idle';
      this.changed();
      throw new Error(friendlyError(e));
    }
    this.code = code;
    this.hostConn = conn;
    this.mode = 'guest';
    this.state = null;
    this.remoteKey = null;
    this.loadedKey = null;
    this.loadingKey = null;
    this.metaShown = false;
    this.ready = false;
    this.offset = 0;
    this.bestRtt = Infinity;
    this.player.enterRemote({ command: (c) => this.sendCommand(c) });
    conn.on('data', (d) => this.onGuestData(d));
    conn.on('close', () => { if (this.mode === 'guest') this.leave('Koneksi ke sesi terputus.'); });
    conn.on('error', () => { if (this.mode === 'guest') this.leave('Koneksi ke sesi terputus.'); });
    this.peer.on('error', (e) => console.warn('Dengar Bareng:', e));
    this.syncClock();
    this.clockTimer = setInterval(() => this.syncClock(), 20000);
    this.syncTimer = setInterval(() => this.syncPlayback(), 400);
    this.changed();
  }

  sendCommand(c) {
    if (this.hostConn && this.hostConn.open) this.hostConn.send({ t: 'cmd', ...c });
  }

  async syncClock() {
    this.bestRtt = Infinity;
    for (let i = 0; i < 6 && this.mode === 'guest'; i++) {
      if (this.hostConn && this.hostConn.open) this.hostConn.send({ t: 'ping', a: now() });
      await sleep(150);
    }
  }

  reportStatus(s) {
    if (s === this.lastStatus || !this.hostConn || !this.hostConn.open) return;
    this.lastStatus = s;
    this.hostConn.send({ t: 'status', s });
  }

  onGuestData(d) {
    if (!d || typeof d !== 'object') return;
    switch (d.t) {
      case 'hello': this.hostName = String(d.name || 'Teman').slice(0, 40); this.info(`Tersambung dengan ${this.hostName}`); this.changed(); break;
      case 'pong': {
        const b = now();
        const rtt = b - d.a;
        if (rtt < this.bestRtt) { this.bestRtt = rtt; this.offset = d.h - (d.a + b) / 2; }
        break;
      }
      case 'state': if (!this.state || d.seq > this.state.seq || d.seq < 3) { this.state = d; this.handleState(); } break;
      case 'file-start':
        this.incoming = { key: d.key, size: d.size, mime: d.mime, parts: [], got: 0, cover: d.cover ? new Blob([d.cover], { type: d.coverMime || 'image/jpeg' }) : null };
        this.recvPct = 0;
        this.changed();
        break;
      case 'chunk':
        if (this.incoming && this.incoming.key === d.key && d.d) {
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
        if (this.incoming && this.incoming.key === d.key) {
          const inc = this.incoming;
          this.incoming = null;
          this.cache.set(inc.key, { blob: new Blob(inc.parts, { type: inc.mime }), cover: inc.cover });
          while (this.cache.size > MAX_CACHE) {
            const oldest = [...this.cache.keys()].find((k) => k !== (this.state && this.state.song && this.state.song.key));
            this.cache.delete(oldest);
          }
          this.requested.delete(inc.key);
          if (this.state && this.state.song && this.state.song.key === inc.key) this.handleState();
          else this.requestNext();
          this.changed();
        }
        break;
      case 'file-missing': this.requested.delete(d.key); break;
      case 'full': this.leave('Sesi sudah penuh.'); break;
      case 'bye': this.leave('Sesi diakhiri oleh pembuat sesi.'); break;
      default: break;
    }
  }

  findLocal(key) {
    return store.all().find((s) => s.audioHash === key || (!s.convertedFrom && s.srcHash === key)) || null;
  }

  requestFile(key) {
    if (this.requested.has(key) || this.cache.has(key) || !this.hostConn || !this.hostConn.open) return;
    this.requested.add(key);
    this.hostConn.send({ t: 'need', key });
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
      // lagu berganti
      this.remoteKey = s.key;
      this.loadedKey = null;
      this.metaShown = false;
      this.ready = false;
    }
    if (this.loadedKey !== s.key) {
      if (this.loadingKey === s.key) return; // sedang dimuat; status berikutnya akan menyinkronkan
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
        // belum punya file: tampilkan judul sambil menunggu kiriman dari host
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

  /** Samakan posisi lagu dengan HP pembuat sesi. */
  syncPlayback(force = false) {
    if (this.mode !== 'guest' || !this.ready) return;
    const st = this.state;
    const a = this.player.audio;
    if (!st || !st.song || a.readyState < 1) return;
    const hostNow = now() + this.offset;
    let target = st.pos + (st.playing ? (hostNow - st.at) / 1000 : 0) - this.delayMs / 1000;
    const dur = Number.isFinite(a.duration) ? a.duration : 0;
    if (dur && target > dur - 0.05) target = dur - 0.05;
    if (target < 0) target = 0;
    const diff = a.currentTime - target;
    this.drift = diff;
    if (!st.playing) {
      if (!a.paused) a.pause();
      a.playbackRate = 1;
      if (Math.abs(diff) > 0.25 || force) { try { a.currentTime = target; } catch { /* abaikan */ } }
      return;
    }
    if (a.paused) {
      try { a.currentTime = Math.min(dur || target + 1, target + 0.08); } catch { /* abaikan */ }
      a.play().then(() => { this.needTap = false; }).catch(() => { this.needTap = true; this.changed(); });
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

  // ================= KELUAR =================
  leave(reason = '') {
    const wasGuest = this.mode === 'guest';
    const wasHost = this.mode === 'host';
    if (this.mode === 'idle') return;
    clearInterval(this.syncTimer);
    clearInterval(this.clockTimer);
    clearInterval(this.heartbeat);
    clearTimeout(this.bcTimer);
    if (wasHost) {
      for (const g of this.guests.values()) { try { g.conn.send({ t: 'bye' }); } catch { /* abaikan */ } }
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
    const peer = this.peer;
    setTimeout(() => { try { peer && peer.destroy(); } catch { /* abaikan */ } }, wasHost ? 400 : 0);
    this.peer = null;
    this.guests.clear();
    this.hostConn = null;
    this.mode = 'idle';
    this.code = '';
    this.state = null;
    this.incoming = null;
    this.requested.clear();
    this.cache.clear();
    this.remoteKey = null;
    this.loadedKey = null;
    this.loadingKey = null;
    this.metaShown = false;
    this.ready = false;
    this.lastStatus = '';
    if (wasGuest) {
      this.player.audio.playbackRate = 1;
      this.player.exitRemote();
    }
    if (reason) this.info(reason, wasGuest ? 'warn' : '');
    this.changed();
  }
}

export const together = new Together();
window.addEventListener('pagehide', () => { if (together.mode === 'host') together.leave(); });
