// Worker: mengubah suara (PCM) menjadi MP3 memakai LAME (lamejs), di luar thread tampilan
// agar aplikasi tetap lancar selama proses berlangsung.
/* global lamejs */
importScripts('vendor/lame.min.js');

function toInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = f32[i] < -1 ? -1 : f32[i] > 1 ? 1 : f32[i];
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

self.onmessage = (e) => {
  const { left, right, sampleRate, kbps } = e.data;
  try {
    const channels = right ? 2 : 1;
    const encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
    const block = 1152 * 20;
    const chunks = [];
    const total = left.length;
    let lastReport = 0;
    for (let i = 0; i < total; i += block) {
      const l = toInt16(left.subarray(i, i + block));
      const buf = right ? encoder.encodeBuffer(l, toInt16(right.subarray(i, i + block))) : encoder.encodeBuffer(l);
      if (buf.length) chunks.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.length).slice());
      const pct = Math.floor((i / total) * 100);
      if (pct >= lastReport + 2) {
        lastReport = pct;
        self.postMessage({ type: 'progress', pct });
      }
    }
    const end = encoder.flush();
    if (end.length) chunks.push(new Uint8Array(end.buffer, end.byteOffset, end.length).slice());
    self.postMessage({ type: 'done', blob: new Blob(chunks, { type: 'audio/mpeg' }) });
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
