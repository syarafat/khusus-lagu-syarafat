// Penyimpanan lokal berbasis IndexedDB.
// songs     : metadata lagu (judul, artis, durasi, dll.)
// audio     : file audio (Blob), kunci = id lagu
// covers    : gambar sampul (Blob), kunci = id lagu
// playlists : daftar putar

const DB_NAME = 'lagu-syarafat';
const DB_VERSION = 1;
let dbPromise = null;

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new DOMException('Transaksi dibatalkan', 'AbortError'));
  });
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Browser ini tidak mendukung penyimpanan lokal (IndexedDB).'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
      if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers');
      if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database sedang dipakai di tab lain. Tutup tab lain lalu muat ulang.'));
  });
  return dbPromise;
}

export async function getAll(store) {
  const db = await openDB();
  return promisify(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await openDB();
  return promisify(db.transaction(store).objectStore(store).get(key));
}

export async function put(store, value, key) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  if (key === undefined) tx.objectStore(store).put(value);
  else tx.objectStore(store).put(value, key);
  return done(tx);
}

export async function del(store, key) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return done(tx);
}

/** Simpan lagu baru beserta file audio & sampulnya dalam satu transaksi. */
export async function saveSong(song, audioBlob, coverBlob) {
  const db = await openDB();
  const tx = db.transaction(['songs', 'audio', 'covers'], 'readwrite');
  tx.objectStore('songs').put(song);
  if (audioBlob) tx.objectStore('audio').put(audioBlob, song.id);
  if (coverBlob) tx.objectStore('covers').put(coverBlob, song.id);
  return done(tx);
}

/** Hapus lagu (metadata, audio, sampul) dan perbarui playlist terkait. */
export async function deleteSongs(ids, updatedPlaylists = []) {
  const db = await openDB();
  const tx = db.transaction(['songs', 'audio', 'covers', 'playlists'], 'readwrite');
  for (const id of ids) {
    tx.objectStore('songs').delete(id);
    tx.objectStore('audio').delete(id);
    tx.objectStore('covers').delete(id);
  }
  for (const pl of updatedPlaylists) tx.objectStore('playlists').put(pl);
  return done(tx);
}

export async function clearAll() {
  const db = await openDB();
  const stores = ['songs', 'audio', 'covers', 'playlists'];
  const tx = db.transaction(stores, 'readwrite');
  stores.forEach((s) => tx.objectStore(s).clear());
  return done(tx);
}
