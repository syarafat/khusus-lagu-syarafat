// Status aplikasi di memori + sinkronisasi ke IndexedDB.
import * as db from './db.js';

const listeners = new Set();
const coverCache = new Map(); // id -> Promise<string|null>
const coverReady = new Map(); // id -> string (URL yang sudah siap)

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

const SETTINGS_KEY = 'lagu-settings';
const defaultSettings = {
  accent: 'violet',
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: 'off', // off | all | one
  librarySort: 'added',
  libraryTab: 'songs',
};

function loadSettings() {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...defaultSettings };
  }
}

export const store = {
  songs: new Map(),
  playlists: new Map(),
  settings: loadSettings(),
  ready: false,

  async init() {
    const [songs, playlists] = await Promise.all([db.getAll('songs'), db.getAll('playlists')]);
    songs.forEach((s) => this.songs.set(s.id, s));
    playlists.forEach((p) => this.playlists.set(p.id, p));
    this.ready = true;
    emit('init');
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  saveSettings(patch = {}) {
    Object.assign(this.settings, patch);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* abaikan */ }
    emit('settings');
  },

  // ---------- Lagu ----------
  get(id) { return this.songs.get(id); },
  all() { return [...this.songs.values()]; },
  liked() {
    return this.all().filter((s) => s.liked).sort((a, b) => (b.likedAt || 0) - (a.likedAt || 0));
  },
  recentlyAdded(n = 12) {
    return this.all().sort((a, b) => b.addedAt - a.addedAt).slice(0, n);
  },
  recentlyPlayed(n = 12) {
    return this.all().filter((s) => s.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, n);
  },
  findDuplicate(fileName, size) {
    for (const s of this.songs.values()) {
      if ((s.fileName === fileName && s.size === size) || (s.origName === fileName && s.origSize === size)) return s;
    }
    return null;
  },
  totalBytes() {
    let n = 0;
    for (const s of this.songs.values()) n += s.size || 0;
    return n;
  },

  async addSong(song, audioBlob, coverBlob) {
    await db.saveSong(song, audioBlob, coverBlob);
    this.songs.set(song.id, song);
    emit('songs');
    return song;
  },

  async updateSong(id, patch) {
    const s = this.songs.get(id);
    if (!s) return null;
    const next = { ...s, ...patch };
    await db.put('songs', next);
    this.songs.set(id, next);
    emit('songs');
    return next;
  },

  async setCover(id, blob, color) {
    const s = this.songs.get(id);
    if (!s) return;
    if (blob) await db.put('covers', blob, id);
    else await db.del('covers', id);
    dropCover(id);
    await this.updateSong(id, { hasCover: !!blob, remoteCover: null, ...(color ? { color } : {}) });
  },

  async toggleLike(id) {
    const s = this.songs.get(id);
    if (!s) return false;
    const liked = !s.liked;
    await this.updateSong(id, { liked, likedAt: liked ? Date.now() : 0 });
    return liked;
  },

  async recordPlay(id) {
    const s = this.songs.get(id);
    if (!s) return;
    const next = { ...s, playCount: (s.playCount || 0) + 1, lastPlayed: Date.now() };
    this.songs.set(id, next);
    try { await db.put('songs', next); } catch { /* abaikan */ }
    emit('played');
  },

  async deleteSongs(ids) {
    const set = new Set(ids);
    const changed = [];
    for (const pl of this.playlists.values()) {
      if (pl.songIds.some((x) => set.has(x))) {
        const next = { ...pl, songIds: pl.songIds.filter((x) => !set.has(x)), updatedAt: Date.now() };
        changed.push(next);
      }
    }
    await db.deleteSongs(ids, changed);
    ids.forEach((id) => { this.songs.delete(id); dropCover(id); });
    changed.forEach((p) => this.playlists.set(p.id, p));
    emit('songs-deleted', ids);
  },

  async deleteEverything() {
    await db.clearAll();
    for (const id of this.songs.keys()) dropCover(id);
    const ids = [...this.songs.keys()];
    this.songs.clear();
    this.playlists.clear();
    emit('songs-deleted', ids);
  },

  async audioBlob(id) {
    return db.get('audio', id);
  },

  coverUrl(id) {
    const s = this.songs.get(id);
    if (!s || !s.hasCover) return Promise.resolve(null);
    if (s.remoteCover) return Promise.resolve(s.remoteCover);
    if (!coverCache.has(id)) {
      coverCache.set(id, db.get('covers', id).then((b) => {
        if (!b) return null;
        const url = URL.createObjectURL(b);
        coverReady.set(id, url);
        return url;
      }).catch(() => null));
    }
    return coverCache.get(id);
  },

  /** URL sampul bila sudah pernah dimuat (agar tidak berkedip saat render ulang). */
  coverUrlSync(id) {
    const s = this.songs.get(id);
    if (s && s.hasCover && s.remoteCover) return s.remoteCover;
    return coverReady.get(id) || null;
  },

  findYouTube(ytId) {
    for (const s of this.songs.values()) if (s.source === 'youtube' && s.ytId === ytId) return s;
    return null;
  },

  // ---------- Playlist ----------
  playlistList() {
    return [...this.playlists.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },

  playlistSongs(id) {
    const pl = this.playlists.get(id);
    if (!pl) return [];
    return pl.songIds.map((sid) => this.songs.get(sid)).filter(Boolean);
  },

  async createPlaylist(name, songIds = []) {
    const now = Date.now();
    const pl = { id: uid(), name: name.trim() || 'Playlist baru', songIds: [...new Set(songIds)], createdAt: now, updatedAt: now };
    await db.put('playlists', pl);
    this.playlists.set(pl.id, pl);
    emit('playlists');
    return pl;
  },

  async savePlaylist(pl) {
    const next = { ...pl, updatedAt: Date.now() };
    await db.put('playlists', next);
    this.playlists.set(next.id, next);
    emit('playlists');
    return next;
  },

  async renamePlaylist(id, name) {
    const pl = this.playlists.get(id);
    if (!pl) return;
    await this.savePlaylist({ ...pl, name: name.trim() || pl.name });
  },

  async deletePlaylist(id) {
    await db.del('playlists', id);
    this.playlists.delete(id);
    emit('playlists');
  },

  async addToPlaylist(id, songIds) {
    const pl = this.playlists.get(id);
    if (!pl) return 0;
    const existing = new Set(pl.songIds);
    const toAdd = songIds.filter((s) => !existing.has(s));
    if (!toAdd.length) return 0;
    await this.savePlaylist({ ...pl, songIds: [...pl.songIds, ...toAdd] });
    return toAdd.length;
  },

  async removeFromPlaylist(id, songIds) {
    const pl = this.playlists.get(id);
    if (!pl) return;
    const rm = new Set(songIds);
    await this.savePlaylist({ ...pl, songIds: pl.songIds.filter((s) => !rm.has(s)) });
  },

  async movePlaylistSong(id, from, to) {
    const pl = this.playlists.get(id);
    if (!pl) return;
    const arr = [...pl.songIds];
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
    await this.savePlaylist({ ...pl, songIds: arr });
  },
};

function dropCover(id) {
  coverReady.delete(id);
  const p = coverCache.get(id);
  if (p) {
    p.then((url) => url && URL.revokeObjectURL(url));
    coverCache.delete(id);
  }
}

function emit(type, detail) {
  listeners.forEach((fn) => {
    try { fn(type, detail); } catch (e) { console.error(e); }
  });
}
