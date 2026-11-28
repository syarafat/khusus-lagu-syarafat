// Mengubah file video menjadi MP3 (hanya suara), seluruhnya di perangkat — tanpa internet.
// Langkah: ambil suara dari video (Web Audio decodeAudioData) → encode ke MP3 di worker (LAME).

export const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv', '3gp', '3g2', 'avi', 'wmv', 'flv', 'ts', 'mts'];
const MAX_VIDEO_BYTES = 350 * 1024 * 1024; // batas aman memori HP
const MP3_KBPS = 128;
const SAMPLE_RATE = 44100;

function extOf(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

export function isVideoFile(f) {
  if (!f) return false;
  if (f.type && f.type.startsWith('audio/')) return false;
  if (f.type && f.type.startsWith('video/')) return true;
  return VIDEO_EXT.includes(extOf(f.name));
}

export class ConvertError extends Error {}

function encodeInWorker(left, right, sampleRate, onProgress) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./mp3worker.js', import.meta.url));
    } catch {
      reject(new ConvertError('Browser ini tidak mendukung pengubahan ke MP3.'));
      return;
    }
    worker.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'progress') onProgress(d.pct);
      else if (d.type === 'done') { worker.terminate(); resolve(d.blob); }
      else if (d.type === 'error') { worker.terminate(); reject(new ConvertError('Gagal mengubah ke MP3: ' + d.message)); }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new ConvertError('Gagal mengubah ke MP3' + (e.message ? ': ' + e.message : '.')));
    };
    const transfer = [left.buffer];
    if (right) transfer.push(right.buffer);
    worker.postMessage({ left, right, sampleRate, kbps: MP3_KBPS }, transfer);
  });
}

/**
 * Ubah video menjadi MP3.
 * onProgress(persen 0-100, keterangan)
 * Hasil: { blob (audio/mpeg), duration (detik) }
 */
export async function videoToMp3(file, onProgress = () => {}) {
  if (file.size > MAX_VIDEO_BYTES) {
    throw new ConvertError(`Video terlalu besar (${Math.round(file.size / 1048576)} MB). Maksimal ${Math.round(MAX_VIDEO_BYTES / 1048576)} MB.`);
  }
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) throw new ConvertError('Browser ini tidak mendukung pengubahan video.');

  onProgress(0, 'Membaca video');
  let data = await file.arrayBuffer();
  onProgress(2, 'Mengambil suara dari video');
  let audio;
  try {
    const ctx = new Ctx(2, 1, SAMPLE_RATE);
    audio = await ctx.decodeAudioData(data);
  } catch {
    throw new ConvertError('Suara tidak bisa diambil dari video ini (video tanpa suara atau formatnya tidak didukung).');
  } finally {
    data = null;
  }
  if (!audio || audio.length < SAMPLE_RATE / 2) throw new ConvertError('Video ini tidak punya suara.');

  const stereo = audio.numberOfChannels >= 2;
  const left = new Float32Array(audio.length);
  audio.copyFromChannel(left, 0);
  let right = null;
  if (stereo) {
    right = new Float32Array(audio.length);
    audio.copyFromChannel(right, 1);
  }
  const { duration, sampleRate } = audio;
  audio = null;

  onProgress(5, 'Mengubah ke MP3');
  const blob = await encodeInWorker(left, right, sampleRate, (p) => onProgress(5 + Math.round(p * 0.95), 'Mengubah ke MP3'));
  onProgress(100, 'Selesai');
  return { blob, duration };
}

// ---------- Sampul dari video ----------

/** Nilai seberapa "bagus" sebuah gambar untuk sampul: terang cukup, kontras & berwarna. */
function frameScore(ctx, w, h) {
  const px = ctx.getImageData(0, 0, w, h).data;
  let sum = 0;
  let sumSq = 0;
  let sat = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i]; const g = px[i + 1]; const b = px[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += l; sumSq += l * l;
    sat += Math.max(r, g, b) - Math.min(r, g, b);
    n++;
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  let score = std + (sat / n) * 0.35;
  if (mean < 28) score -= 60; // hampir hitam
  if (mean > 235) score -= 40; // hampir putih
  return { score, mean };
}

function once(el, type, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { el.removeEventListener(type, h); resolve(false); }, ms);
    const h = () => { clearTimeout(t); resolve(true); };
    el.addEventListener(type, h, { once: true });
  });
}

/**
 * Ambil cuplikan terbaik dari video sebagai sampul: cek beberapa titik,
 * pilih yang paling jelas (bukan layar hitam / buram). null bila gagal.
 */
export async function captureBestFrame(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  const cleanup = () => {
    v.removeAttribute('src');
    try { v.load(); } catch { /* abaikan */ }
    URL.revokeObjectURL(url);
  };
  try {
    let ok = await once(v, 'loadeddata', 6000);
    if (!ok) {
      // Beberapa browser (mis. Safari) baru memuat gambar setelah diputar sebentar
      try { await v.play(); v.pause(); } catch { /* abaikan */ }
      ok = v.readyState >= 2 || (await once(v, 'loadeddata', 4000));
    }
    if (!ok || !v.videoWidth) return null;
    const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    const points = d > 4 ? [0.1, 0.22, 0.35, 0.5, 0.65] : [0.5];
    const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
    const W = Math.max(1, Math.round(v.videoWidth * scale));
    const H = Math.max(1, Math.round(v.videoHeight * scale));
    const probe = document.createElement('canvas');
    probe.width = 64; probe.height = 36;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    let best = null;
    const started = Date.now();
    for (const p of points) {
      if (Date.now() - started > 9000) break;
      const target = d ? Math.min(d * p, d - 0.1) : 0;
      if (Math.abs(v.currentTime - target) > 0.05) {
        v.currentTime = target;
        if (!(await once(v, 'seeked', 3000))) continue;
      }
      pctx.drawImage(v, 0, 0, 64, 36);
      const { score } = frameScore(pctx, 64, 36);
      if (!best || score > best.score) {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        c.getContext('2d').drawImage(v, 0, 0, W, H);
        best = { score, canvas: c };
        if (score > 95) break; // sudah cukup bagus
      }
    }
    if (!best) return null;
    return await new Promise((resolve) => best.canvas.toBlob(resolve, 'image/jpeg', 0.9));
  } catch {
    return null;
  } finally {
    cleanup();
  }
}

// --- Foto sampul yang tersimpan di dalam file MKV/WEBM (lampiran "cover") ---
async function readBytes(file, start, end) {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

/** Baca kepala elemen EBML (ID + ukuran) pada posisi tertentu. */
async function ebmlHeader(file, pos) {
  const b = await readBytes(file, pos, pos + 12);
  if (b.length < 2) return null;
  let idLen = 1;
  while (idLen <= 4 && !(b[0] & (0x80 >> (idLen - 1)))) idLen++;
  if (idLen > 4) return null;
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + b[i];
  const first = b[idLen];
  let szLen = 1;
  while (szLen <= 8 && !(first & (0x80 >> (szLen - 1)))) szLen++;
  if (szLen > 8) return null;
  let size = first & (0xff >> szLen);
  let allOnes = size === (0xff >> szLen);
  for (let i = 1; i < szLen; i++) {
    const x = b[idLen + i];
    if (x !== 0xff) allOnes = false;
    size = size * 256 + x;
  }
  return { id, size: allOnes ? -1 : size, header: idLen + szLen };
}

function childrenOf(buf, start, end) {
  const out = [];
  let pos = start;
  while (pos < end) {
    let idLen = 1;
    while (idLen <= 4 && !(buf[pos] & (0x80 >> (idLen - 1)))) idLen++;
    if (idLen > 4) break;
    let id = 0;
    for (let i = 0; i < idLen; i++) id = id * 256 + buf[pos + i];
    const f = buf[pos + idLen];
    let szLen = 1;
    while (szLen <= 8 && !(f & (0x80 >> (szLen - 1)))) szLen++;
    if (szLen > 8) break;
    let size = f & (0xff >> szLen);
    for (let i = 1; i < szLen; i++) size = size * 256 + buf[pos + idLen + i];
    const dataStart = pos + idLen + szLen;
    if (dataStart + size > end) break;
    out.push({ id, start: dataStart, end: dataStart + size });
    pos = dataStart + size;
  }
  return out;
}

const EBML = { HEADER: 0x1a45dfa3, SEGMENT: 0x18538067, SEEKHEAD: 0x114d9b74, SEEK: 0x4dbb, SEEKID: 0x53ab, SEEKPOS: 0x53ac, ATTACHMENTS: 0x1941a469, FILE: 0x61a7, NAME: 0x466e, MIME: 0x4660, DATA: 0x465c, CLUSTER: 0x1f43b675 };

async function parseMkvCover(file) {
  const head = await ebmlHeader(file, 0);
  if (!head || head.id !== EBML.HEADER || head.size < 0) return null;
  const seg = await ebmlHeader(file, head.header + head.size);
  if (!seg || seg.id !== EBML.SEGMENT) return null;
  const segData = head.header + head.size + seg.header;
  const segEnd = seg.size < 0 ? file.size : Math.min(file.size, segData + seg.size);

  const readAttachments = async (pos) => {
    const el = await ebmlHeader(file, pos);
    if (!el || el.id !== EBML.ATTACHMENTS || el.size < 0 || el.size > 30 * 1048576) return null;
    const buf = await readBytes(file, pos + el.header, pos + el.header + el.size);
    const td = new TextDecoder();
    const images = [];
    for (const f of childrenOf(buf, 0, buf.length)) {
      if (f.id !== EBML.FILE) continue;
      const item = {};
      for (const c of childrenOf(buf, f.start, f.end)) {
        if (c.id === EBML.NAME) item.name = td.decode(buf.subarray(c.start, c.end));
        else if (c.id === EBML.MIME) item.mime = td.decode(buf.subarray(c.start, c.end));
        else if (c.id === EBML.DATA) item.data = buf.subarray(c.start, c.end);
      }
      if (item.data && /^image\//i.test(item.mime || '')) images.push(item);
    }
    if (!images.length) return null;
    const pick = images.find((x) => /cover/i.test(x.name || '')) || images[0];
    return new Blob([pick.data.slice()], { type: pick.mime });
  };

  // Jalan 1: lewat daftar isi (SeekHead) di awal file
  let pos = segData;
  for (let n = 0; n < 5000 && pos < segEnd; n++) {
    const el = await ebmlHeader(file, pos);
    if (!el) break;
    if (el.id === EBML.ATTACHMENTS) return readAttachments(pos);
    if (el.id === EBML.SEEKHEAD && el.size > 0 && el.size < 1048576) {
      const buf = await readBytes(file, pos + el.header, pos + el.header + el.size);
      for (const sk of childrenOf(buf, 0, buf.length)) {
        if (sk.id !== EBML.SEEK) continue;
        let sid = 0;
        let spos = -1;
        for (const c of childrenOf(buf, sk.start, sk.end)) {
          if (c.id === EBML.SEEKID) { sid = 0; for (let i = c.start; i < c.end; i++) sid = sid * 256 + buf[i]; }
          if (c.id === EBML.SEEKPOS) { spos = 0; for (let i = c.start; i < c.end; i++) spos = spos * 256 + buf[i]; }
        }
        if (sid === EBML.ATTACHMENTS && spos >= 0) return readAttachments(segData + spos);
      }
    }
    // Jalan 2: telusuri elemen satu per satu (berhenti di klaster tanpa ukuran)
    if (el.size < 0) break;
    pos += el.header + el.size;
  }
  return null;
}

/**
 * Sampul untuk video: foto sampul yang tersimpan di file (MP4/MKV) bila ada,
 * jika tidak, cuplikan terbaik dari videonya.
 */
export async function extractVideoCover(file, tags = {}) {
  if (tags.picture && tags.picture.data && tags.picture.data.length > 1000) {
    return new Blob([tags.picture.data], { type: tags.picture.mime || 'image/jpeg' });
  }
  try {
    const head = await readBytes(file, 0, 4);
    if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
      const mkv = await parseMkvCover(file);
      if (mkv) return mkv;
    }
  } catch { /* lanjut ke cuplikan */ }
  return captureBestFrame(file);
}
