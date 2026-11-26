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

/** Ambil satu gambar dari video untuk dijadikan sampul (null bila gagal). */
export function captureFrame(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    let done = false;
    let tries = 0;
    const finish = (blob) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      try { v.load(); } catch { /* abaikan */ }
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    const timer = setTimeout(() => finish(null), 12000);
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    const seekTo = (frac) => {
      const d = Number.isFinite(v.duration) ? v.duration : 0;
      v.currentTime = d ? Math.min(d * frac, d - 0.1) : 1;
    };
    v.addEventListener('loadeddata', () => {
      if (!v.videoWidth) { finish(null); return; }
      seekTo(0.3);
    }, { once: true });
    v.addEventListener('seeked', () => {
      try {
        const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        const ctx = c.getContext('2d');
        ctx.drawImage(v, 0, 0, c.width, c.height);
        // Hindari gambar yang hampir hitam (mis. awal/akhir video)
        const px = ctx.getImageData(0, 0, c.width, c.height).data;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < px.length; i += 4 * 97) { sum += px[i] + px[i + 1] + px[i + 2]; n++; }
        if (sum / (n * 3) < 18 && tries < 2) {
          tries++;
          seekTo(tries === 1 ? 0.5 : 0.15);
          return;
        }
        c.toBlob((b) => finish(b), 'image/jpeg', 0.88);
      } catch {
        finish(null);
      }
    });
    v.addEventListener('error', () => finish(null), { once: true });
    v.src = url;
  });
}
