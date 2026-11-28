// Proses menambah lagu: baca tag, durasi, sampul, lalu simpan.
import { store, uid } from './store.js';
import { readTags, guessFromFilename, cleanTitle } from './metadata.js';
import { isYouTubeUrl } from './ytengine.js';
import { isVideoFile, videoToMp3, extractVideoCover, ConvertError } from './convert.js';

export const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'weba', 'aif', 'aiff', 'caf', 'amr', 'm4b'];

export function extOf(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function isAudioFile(f) {
  if (!f) return false;
  if (f.type && f.type.startsWith('audio/')) return true;
  return AUDIO_EXT.includes(extOf(f.name));
}

/** File yang bisa ditambahkan: lagu, atau video (diubah otomatis ke MP3). */
export function isMediaFile(f) {
  return isAudioFile(f) || isVideoFile(f);
}

/** Ambil durasi (detik) dengan elemen audio sementara. Gagal = format tak didukung. */
function probeDuration(src) {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = 'metadata';
    let settled = false;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      a.removeAttribute('src');
      try { a.load(); } catch { /* abaikan */ }
      fn(v);
    };
    const t = setTimeout(() => finish(resolve, 0), 15000);
    a.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(a.duration) && a.duration > 0) finish(resolve, a.duration);
      else {
        // Beberapa file VBR melaporkan Infinity: lompat ke akhir agar durasi terhitung.
        a.currentTime = 1e7;
        a.addEventListener('durationchange', () => {
          if (Number.isFinite(a.duration) && a.duration > 0) finish(resolve, a.duration);
        });
        setTimeout(() => finish(resolve, 0), 3000);
      }
    });
    a.addEventListener('error', () => finish(reject, new Error('unsupported')));
    a.src = src;
  });
}

function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export function placeholderColor(seed) {
  return `hsl(${hashHue(seed || 'x')} 42% 34%)`;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

async function loadBitmap(blob) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob); } catch { /* lanjut ke cara lain */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('gambar rusak')); };
    img.src = url;
  });
}

/**
 * Kecilkan sampul jadi maks 600px & ambil warna dominan untuk latar.
 * crop (opsional, dalam pecahan 0..1): bagian gambar yang dipakai, mis. untuk
 * membuang garis hitam pada thumbnail YouTube.
 */
export async function processCover(blob, crop = null) {
  const img = await loadBitmap(blob);
  const iw = img.width || img.naturalWidth;
  const ih = img.height || img.naturalHeight;
  if (!iw || !ih) throw new Error('gambar kosong');
  const cx = crop ? crop.x * iw : 0;
  const cy = crop ? crop.y * ih : 0;
  const w = crop ? crop.w * iw : iw;
  const h = crop ? crop.h * ih : ih;
  const side = Math.min(w, h);
  const sx = cx + (w - side) / 2;
  const sy = cy + (h - side) / 2;
  const size = Math.min(600, side);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

  // Warna rata-rata (lebih condong ke piksel berwarna) dari versi kecil.
  const small = document.createElement('canvas');
  small.width = 24;
  small.height = 24;
  const sctx = small.getContext('2d');
  sctx.drawImage(canvas, 0, 0, 24, 24);
  const px = sctx.getImageData(0, 0, 24, 24).data;
  let r = 0; let g = 0; let b = 0; let wsum = 0;
  for (let i = 0; i < px.length; i += 4) {
    const [, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
    const wgt = 0.15 + s * (1 - Math.abs(l - 0.5) * 1.6);
    r += px[i] * wgt; g += px[i + 1] * wgt; b += px[i + 2] * wgt; wsum += wgt;
  }
  const [hh, ss, ll] = rgbToHsl(r / wsum, g / wsum, b / wsum);
  const color = `hsl(${Math.round(hh)} ${Math.round(Math.min(0.75, Math.max(0.25, ss)) * 100)}% ${Math.round(Math.min(0.42, Math.max(0.24, ll)) * 100)}%)`;

  const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (img.close) img.close();
  return { blob: out || blob, color };
}

async function buildSong(file, extra = {}) {
  const tags = await readTags(file);
  const guess = guessFromFilename(file.name);
  const url = URL.createObjectURL(file);
  let duration = 0;
  try {
    duration = await probeDuration(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  let coverBlob = null;
  let color = null;
  if (tags.picture) {
    try {
      const res = await processCover(new Blob([tags.picture.data], { type: tags.picture.mime }));
      coverBlob = res.blob;
      color = res.color;
    } catch { /* sampul rusak, abaikan */ }
  }
  const title = cleanTitle(tags.title) || guess.title;
  const artist = tags.artist || tags.albumArtist || guess.artist || 'Artis tidak dikenal';
  const song = {
    id: uid(),
    title,
    artist,
    album: tags.album || '',
    albumArtist: tags.albumArtist || '',
    year: tags.year || '',
    track: tags.track || 0,
    duration,
    size: file.size,
    type: file.type || '',
    fileName: file.name,
    source: 'file',
    hasCover: !!coverBlob,
    color: color || placeholderColor(artist + title),
    liked: false,
    likedAt: 0,
    addedAt: Date.now(),
    playCount: 0,
    lastPlayed: 0,
    ...extra,
  };
  return { song, coverBlob };
}

/**
 * Video → MP3: sampul diambil lebih dulu (foto sampul di file, atau cuplikan terbaik),
 * lalu suaranya diubah ke MP3. Videonya sendiri tidak disimpan.
 */
async function buildSongFromVideo(file, onProgress, onCover) {
  const tags = await readTags(file);
  const guess = guessFromFilename(file.name);

  onProgress(0, 'Mengambil sampul video');
  let coverBlob = null;
  let color = null;
  const pic = await extractVideoCover(file, tags);
  if (pic) {
    try {
      const res = await processCover(pic);
      coverBlob = res.blob;
      color = res.color;
      onCover(coverBlob);
    } catch { /* tanpa sampul */ }
  }

  const { blob, duration } = await videoToMp3(file, onProgress);
  const title = cleanTitle(tags.title) || guess.title;
  const artist = tags.artist || tags.albumArtist || guess.artist || 'Artis tidak dikenal';
  const base = file.name.replace(/\.[^.]+$/, '') || 'lagu';
  const song = {
    id: uid(),
    title,
    artist,
    album: tags.album || '',
    albumArtist: tags.albumArtist || '',
    year: tags.year || '',
    track: tags.track || 0,
    duration,
    size: blob.size,
    type: 'audio/mpeg',
    fileName: `${base}.mp3`,
    origName: file.name,
    origSize: file.size,
    convertedFrom: 'video',
    source: 'file',
    hasCover: !!coverBlob,
    color: color || placeholderColor(artist + title),
    liked: false,
    likedAt: 0,
    addedAt: Date.now(),
    playCount: 0,
    lastPlayed: 0,
  };
  return { song, coverBlob, audioBlob: blob };
}

// ---------- Antrean impor global (agar beberapa impor tidak tabrakan) ----------
const status = { running: false, total: 0, done: 0, current: '', note: '', pct: 0, added: 0, converted: 0, dup: 0, failed: [], skipped: 0 };
const statusListeners = new Set();
let pending = [];
let finishedCallbacks = [];
let looping = false;

export function onImportStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}
function emitStatus() { statusListeners.forEach((fn) => fn({ ...status })); }

/** Pratinjau sampul video yang sedang diproses (ditampilkan di kartu progres). */
function setStatusCover(blob) {
  if (status.cover) URL.revokeObjectURL(status.cover);
  status.cover = blob ? URL.createObjectURL(blob) : null;
}

/**
 * Tambahkan banyak file. Mengembalikan ringkasan setelah semua selesai.
 * opts.playlistId: langsung masukkan ke playlist tersebut.
 */
export function importFiles(fileList, opts = {}) {
  const files = [...fileList];
  const audio = files.filter(isMediaFile);
  const skipped = files.length - audio.length;
  return new Promise((resolve) => {
    if (!audio.length) {
      resolve({ added: [], dup: 0, failed: [], skipped, nothing: true });
      return;
    }
    pending.push(...audio.map((f) => ({ file: f, opts })));
    if (!status.running) {
      Object.assign(status, { running: true, total: 0, done: 0, added: 0, converted: 0, dup: 0, failed: [], skipped: 0, addedIds: [] });
    }
    status.total += audio.length;
    status.skipped += skipped;
    finishedCallbacks.push(resolve);
    emitStatus();
    if (!looping) {
      looping = true; // diset sebelum runLoop: bisa selesai seketika (mis. semua file duplikat)
      runLoop();
    }
  });
}

async function runLoop() {
  try {
    while (pending.length) {
      const { file, opts } = pending.shift();
      status.current = file.name;
      status.note = '';
      status.pct = 0;
      setStatusCover(null);
      emitStatus();
      try {
        const dup = store.findDuplicate(file.name, file.size);
        if (dup) {
          status.dup++;
          if (opts.playlistId) await store.addToPlaylist(opts.playlistId, [dup.id]);
        } else if (isVideoFile(file)) {
          let last = 0;
          const { song, coverBlob, audioBlob } = await buildSongFromVideo(file, (pct, note) => {
            status.pct = pct;
            status.note = note;
            const now = Date.now();
            if (now - last > 200 || pct >= 100) { last = now; emitStatus(); }
          }, (cover) => {
            setStatusCover(cover);
            emitStatus();
          });
          await store.addSong(song, audioBlob, coverBlob);
          status.added++;
          status.converted++;
          status.addedIds.push(song.id);
          if (opts.playlistId) await store.addToPlaylist(opts.playlistId, [song.id]);
        } else {
          const { song, coverBlob } = await buildSong(file);
          await store.addSong(song, file, coverBlob);
          status.added++;
          status.addedIds.push(song.id);
          if (opts.playlistId) await store.addToPlaylist(opts.playlistId, [song.id]);
        }
      } catch (err) {
        if (err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''))) {
          status.failed.push({ name: file.name, reason: 'Penyimpanan penuh' });
          pending.forEach((p) => status.failed.push({ name: p.file.name, reason: 'Penyimpanan penuh' }));
          status.done += pending.length;
          pending = [];
        } else if (err instanceof ConvertError) {
          status.failed.push({ name: file.name, reason: err.message });
        } else if (err && err.message === 'unsupported') {
          status.failed.push({ name: file.name, reason: 'Format tidak didukung browser ini' });
        } else {
          console.error(err);
          status.failed.push({ name: file.name, reason: 'Gagal dibaca' });
        }
      }
      status.done++;
      emitStatus();
    }
  } finally {
    const summary = { added: status.addedIds, converted: status.converted, dup: status.dup, failed: status.failed, skipped: status.skipped };
    status.running = false;
    status.current = '';
    status.note = '';
    setStatusCover(null);
    emitStatus();
    const cbs = finishedCallbacks;
    finishedCallbacks = [];
    looping = false;
    cbs.forEach((cb) => cb(summary));
  }
}

/**
 * Tambah lagu dari link. Coba unduh (agar bisa offline); bila server menolak (CORS),
 * simpan sebagai link streaming.
 */
export async function importFromUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl.trim()); } catch { throw new Error('Link tidak valid.'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Link harus diawali http:// atau https://');
  const nameFromUrl = decodeURIComponent(url.pathname.split('/').pop() || '') || url.hostname;

  // 1) Coba unduh langsung (hanya berhasil bila server mengizinkan / CORS)
  try {
    const res = await fetch(url.href, { mode: 'cors' });
    const type = (res.headers.get('content-type') || '').split(';')[0];
    if (res.ok && !type.startsWith('text/')) {
      const blob = await res.blob();
      const name = /\.[a-z0-9]{2,5}$/i.test(nameFromUrl) ? nameFromUrl : nameFromUrl + '.mp3';
      const file = new File([blob], name, { type: blob.type || type || 'audio/mpeg' });
      const summary = await importFiles([file]);
      if (summary.added.length || summary.dup) return { mode: 'download', summary };
    }
  } catch { /* diblokir server / jaringan: lanjut ke mode streaming */ }

  // 2) Simpan sebagai streaming
  let duration = 0;
  try {
    duration = await probeDuration(url.href);
  } catch {
    throw new Error('Link tidak bisa diputar. Pastikan itu link langsung ke file audio (mis. berakhiran .mp3).');
  }
  const guess = guessFromFilename(nameFromUrl);
  const artist = guess.artist || url.hostname.replace(/^www\./, '');
  const song = {
    id: uid(),
    title: guess.title,
    artist,
    album: '',
    albumArtist: '',
    year: '',
    track: 0,
    duration,
    size: 0,
    type: '',
    fileName: nameFromUrl,
    source: 'url',
    url: url.href,
    hasCover: false,
    color: placeholderColor(artist + guess.title),
    liked: false,
    likedAt: 0,
    addedAt: Date.now(),
    playCount: 0,
    lastPlayed: 0,
  };
  await store.addSong(song, null, null);
  return { mode: 'stream', song };
}


/**
 * Tambah banyak link file audio sekaligus.
 * onProgress(done, total) dipanggil setiap selesai satu link.
 */
export async function importLinks(text, onProgress = () => {}) {
  const links = [...new Set(String(text || '').match(/https?:\/\/[^\s<>"']+/g) || [])];
  const result = { added: [], dup: 0, failed: [] };
  if (!links.length) {
    const t = String(text || '').trim();
    if (t) result.failed.push({ link: t, reason: 'Bukan link yang valid (harus diawali https://).' });
    return result;
  }
  for (let i = 0; i < links.length; i++) {
    const link = links[i].replace(/[),.]+$/, '');
    try {
      if (isYouTubeUrl(link)) {
        throw new Error('Link YouTube / YouTube Music tidak didukung. Gunakan link langsung ke file audio.');
      } else {
        const r = await importFromUrl(link);
        if (r.mode === 'download' && !r.summary.added.length) result.dup++;
        else result.added.push(r.song || store.get(r.summary.added[0]));
      }
    } catch (err) {
      result.failed.push({ link, reason: err.message || 'Gagal' });
    }
    onProgress(i + 1, links.length);
  }
  return result;
}
