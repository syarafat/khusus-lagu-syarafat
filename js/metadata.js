// Pembaca tag lagu (judul, artis, album, sampul) tanpa library luar.
// Mendukung: ID3v2.2/2.3/2.4 + ID3v1 (MP3), FLAC, MP4/M4A, Ogg Vorbis/Opus, WAV (RIFF INFO).

const MAX_TAG_BYTES = 24 * 1024 * 1024;

async function bytes(file, start, end) {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

function ascii(b, off, len) {
  let s = '';
  for (let i = 0; i < len && off + i < b.length; i++) s += String.fromCharCode(b[off + i]);
  return s;
}

const be32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const synchsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

const decoders = {};
function decoder(label) {
  if (!decoders[label]) {
    try { decoders[label] = new TextDecoder(label); } catch { decoders[label] = new TextDecoder('utf-8'); }
  }
  return decoders[label];
}

function clean(s) {
  return (s || '').replace(/\u0000+$/g, '').split('\u0000')[0].replace(/\s+/g, ' ').trim();
}

// ---------- ID3v2 ----------
function decodeId3Text(b, enc) {
  if (!b.length) return '';
  if (enc === 1) {
    // UTF-16 dengan BOM
    if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return decoder('utf-16be').decode(b.subarray(2));
    if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return decoder('utf-16le').decode(b.subarray(2));
    return decoder('utf-16le').decode(b);
  }
  if (enc === 2) return decoder('utf-16be').decode(b);
  if (enc === 3) return decoder('utf-8').decode(b);
  return decoder('iso-8859-1').decode(b);
}

function findTerminator(b, start, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return -1;
  }
  for (let i = start; i < b.length; i++) if (b[i] === 0) return i;
  return -1;
}

function removeUnsync(b) {
  const out = new Uint8Array(b.length);
  let j = 0;
  for (let i = 0; i < b.length; i++) {
    out[j++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

function parsePicture(frame, ver) {
  const enc = frame[0];
  let pos = 1;
  let mime;
  if (ver === 2) {
    const fmt = ascii(frame, 1, 3).toUpperCase();
    mime = fmt === 'PNG' ? 'image/png' : 'image/jpeg';
    pos = 4;
  } else {
    const end = findTerminator(frame, 1, 0);
    if (end < 0) return null;
    mime = ascii(frame, 1, end - 1).toLowerCase() || 'image/jpeg';
    if (!mime.includes('/')) mime = 'image/' + (mime === 'png' ? 'png' : 'jpeg');
    pos = end + 1;
  }
  const type = frame[pos];
  pos += 1;
  const dEnd = findTerminator(frame, pos, enc);
  if (dEnd < 0) return null;
  pos = dEnd + (enc === 1 || enc === 2 ? 2 : 1);
  const data = frame.slice(pos);
  if (data.length < 64) return null;
  return { type, mime, data };
}

async function parseId3v2(file) {
  const hdr = await bytes(file, 0, 10);
  const ver = hdr[3];
  const flags = hdr[5];
  const size = synchsafe(hdr, 6);
  if (ver < 2 || ver > 4 || size <= 0 || size > MAX_TAG_BYTES) return {};
  let data = await bytes(file, 10, 10 + size);
  if ((flags & 0x80) && ver < 4) data = removeUnsync(data);
  let pos = 0;
  if (flags & 0x40 && ver > 2) pos = ver === 3 ? be32(data, 0) + 4 : synchsafe(data, 0);
  const idLen = ver === 2 ? 3 : 4;
  const hLen = ver === 2 ? 6 : 10;
  const out = {};
  const pics = [];
  while (pos + hLen <= data.length) {
    const id = ascii(data, pos, idLen);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    let fsize;
    if (ver === 2) fsize = (data[pos + 3] << 16) | (data[pos + 4] << 8) | data[pos + 5];
    else if (ver === 4) fsize = synchsafe(data, pos + 4);
    else fsize = be32(data, pos + 4);
    const fflags = ver > 2 ? (data[pos + 8] << 8) | data[pos + 9] : 0;
    pos += hLen;
    if (fsize <= 0 || pos + fsize > data.length) break;
    let frame = data.subarray(pos, pos + fsize);
    pos += fsize;

    if (ver === 4) {
      const fmt = fflags & 0xff;
      if (fmt & 0x0c) continue; // terkompresi/terenkripsi
      let off = 0;
      if (fmt & 0x40) off += 1;
      if (fmt & 0x01) off += 4;
      frame = frame.subarray(off);
      if (fmt & 0x02) frame = removeUnsync(frame);
    } else if (ver === 3) {
      if (fflags & 0x00c0) continue;
      if (fflags & 0x0020) frame = frame.subarray(1);
    }

    const key = id;
    if (key === 'APIC' || key === 'PIC') {
      const pic = parsePicture(frame, ver);
      if (pic) pics.push(pic);
      continue;
    }
    if (key[0] !== 'T') continue;
    const text = clean(decodeId3Text(frame.subarray(1), frame[0]));
    if (!text) continue;
    switch (key) {
      case 'TIT2': case 'TT2': out.title = text; break;
      case 'TPE1': case 'TP1': out.artist = text; break;
      case 'TPE2': case 'TP2': out.albumArtist = text; break;
      case 'TALB': case 'TAL': out.album = text; break;
      case 'TRCK': case 'TRK': out.track = parseInt(text, 10) || undefined; break;
      case 'TYER': case 'TYE': case 'TDRC': out.year = text.slice(0, 4); break;
      default: break;
    }
  }
  if (pics.length) {
    const pic = pics.find((p) => p.type === 3) || pics[0];
    out.picture = { mime: pic.mime, data: pic.data };
  }
  return out;
}

async function parseId3v1(file) {
  if (file.size < 128) return {};
  const b = await bytes(file, file.size - 128, file.size);
  if (ascii(b, 0, 3) !== 'TAG') return {};
  const d = decoder('iso-8859-1');
  const f = (o, l) => clean(d.decode(b.subarray(o, o + l)));
  const out = {};
  const title = f(3, 30); if (title) out.title = title;
  const artist = f(33, 30); if (artist) out.artist = artist;
  const album = f(63, 30); if (album) out.album = album;
  const year = f(93, 4); if (year) out.year = year;
  return out;
}

// ---------- Vorbis comment (FLAC / Ogg) ----------
function applyVorbis(out, key, value) {
  const v = value.trim();
  if (!v) return;
  switch (key.toUpperCase()) {
    case 'TITLE': out.title = out.title || v; break;
    case 'ARTIST': out.artist = out.artist || v; break;
    case 'ALBUMARTIST': case 'ALBUM ARTIST': out.albumArtist = out.albumArtist || v; break;
    case 'ALBUM': out.album = out.album || v; break;
    case 'TRACKNUMBER': out.track = parseInt(v, 10) || undefined; break;
    case 'DATE': case 'YEAR': out.year = v.slice(0, 4); break;
    default: break;
  }
}

function parseVorbisComment(b, out) {
  const td = decoder('utf-8');
  let pos = 0;
  const vendorLen = le32(b, pos); pos += 4 + vendorLen;
  if (pos + 4 > b.length) return;
  const count = le32(b, pos); pos += 4;
  for (let i = 0; i < count && pos + 4 <= b.length; i++) {
    const len = le32(b, pos); pos += 4;
    if (pos + len > b.length) break;
    const s = td.decode(b.subarray(pos, pos + len)); pos += len;
    const eq = s.indexOf('=');
    if (eq < 1) continue;
    const key = s.slice(0, eq);
    const val = s.slice(eq + 1);
    if (key.toUpperCase() === 'METADATA_BLOCK_PICTURE' && !out.picture) {
      try {
        const bin = Uint8Array.from(atob(val), (c) => c.charCodeAt(0));
        const pic = parseFlacPicture(bin);
        if (pic) out.picture = pic;
      } catch { /* abaikan */ }
    } else {
      applyVorbis(out, key, val);
    }
  }
}

function parseFlacPicture(b) {
  let pos = 0;
  pos += 4; // tipe gambar
  const mimeLen = be32(b, pos); pos += 4;
  const mime = ascii(b, pos, mimeLen) || 'image/jpeg'; pos += mimeLen;
  const descLen = be32(b, pos); pos += 4 + descLen;
  pos += 16; // lebar, tinggi, kedalaman, jumlah warna
  const dataLen = be32(b, pos); pos += 4;
  if (!dataLen || pos + dataLen > b.length) return null;
  return { mime, data: b.slice(pos, pos + dataLen) };
}

async function parseFlac(file) {
  const out = {};
  let pos = 4;
  for (let n = 0; n < 64 && pos + 4 <= file.size; n++) {
    const h = await bytes(file, pos, pos + 4);
    const last = h[0] & 0x80;
    const type = h[0] & 0x7f;
    const len = (h[1] << 16) | (h[2] << 8) | h[3];
    pos += 4;
    if (len > MAX_TAG_BYTES) break;
    if (type === 4) parseVorbisComment(await bytes(file, pos, pos + len), out);
    else if (type === 6 && !out.picture) out.picture = parseFlacPicture(await bytes(file, pos, pos + len));
    pos += len;
    if (last) break;
  }
  return out;
}

async function parseOgg(file) {
  // Kumpulkan paket kedua (header komentar) dari halaman-halaman Ogg pertama.
  const limit = Math.min(file.size, 4 * 1024 * 1024);
  const b = await bytes(file, 0, limit);
  const packets = [];
  let cur = [];
  let pos = 0;
  let serial = null;
  while (pos + 27 <= b.length && packets.length < 2) {
    if (ascii(b, pos, 4) !== 'OggS') break;
    const ser = le32(b, pos + 14);
    const nseg = b[pos + 26];
    const segTable = b.subarray(pos + 27, pos + 27 + nseg);
    let dataPos = pos + 27 + nseg;
    if (serial === null) serial = ser;
    for (let i = 0; i < nseg; i++) {
      const lace = segTable[i];
      if (ser === serial) cur.push(b.subarray(dataPos, dataPos + lace));
      dataPos += lace;
      if (lace < 255 && ser === serial) {
        const total = cur.reduce((a, c) => a + c.length, 0);
        const pkt = new Uint8Array(total);
        let o = 0;
        cur.forEach((c) => { pkt.set(c, o); o += c.length; });
        packets.push(pkt);
        cur = [];
        if (packets.length >= 2) break;
      }
    }
    pos = dataPos;
  }
  const out = {};
  const pkt = packets[1];
  if (!pkt) return out;
  if (ascii(pkt, 0, 8) === 'OpusTags') parseVorbisComment(pkt.subarray(8), out);
  else if (pkt[0] === 3 && ascii(pkt, 1, 6) === 'vorbis') parseVorbisComment(pkt.subarray(7), out);
  return out;
}

// ---------- MP4 / M4A ----------
async function readAtomHeader(file, pos) {
  const h = await bytes(file, pos, pos + 16);
  if (h.length < 8) return null;
  let size = be32(h, 0);
  const type = ascii(h, 4, 4);
  let header = 8;
  if (size === 1) { size = be32(h, 8) * 2 ** 32 + be32(h, 12); header = 16; }
  else if (size === 0) size = file.size - pos;
  return { size, type, header };
}

function childAtoms(b, start, end) {
  const list = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = be32(b, pos);
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    let header = 8;
    if (size === 1) { size = be32(b, pos + 8) * 2 ** 32 + be32(b, pos + 12); header = 16; }
    if (size === 0) size = end - pos;
    if (size < header || pos + size > end) break;
    list.push({ type, start: pos + header, end: pos + size });
    pos += size;
  }
  return list;
}

async function parseMp4(file) {
  let pos = 0;
  let moov = null;
  for (let n = 0; n < 64 && pos < file.size; n++) {
    const a = await readAtomHeader(file, pos);
    if (!a || a.size < 8) break;
    if (a.type === 'moov') { moov = { pos, size: a.size, header: a.header }; break; }
    pos += a.size;
  }
  if (!moov || moov.size > MAX_TAG_BYTES * 2) return {};
  const b = await bytes(file, moov.pos, moov.pos + moov.size);
  const find = (list, t) => list.find((x) => x.type === t);
  const top = childAtoms(b, moov.header, b.length);
  const udta = find(top, 'udta');
  if (!udta) return {};
  const meta = find(childAtoms(b, udta.start, udta.end), 'meta');
  if (!meta) return {};
  // 'meta' biasanya punya 4 byte versi/flag sebelum anak-anaknya.
  let metaStart = meta.start;
  if (b[metaStart] === 0 && b[metaStart + 1] === 0 && b[metaStart + 2] === 0 && b[metaStart + 3] === 0) metaStart += 4;
  const ilst = find(childAtoms(b, metaStart, meta.end), 'ilst');
  if (!ilst) return {};
  const out = {};
  const td = decoder('utf-8');
  for (const item of childAtoms(b, ilst.start, ilst.end)) {
    const data = find(childAtoms(b, item.start, item.end), 'data');
    if (!data) continue;
    const kind = be32(b, data.start) & 0xffffff;
    const val = b.subarray(data.start + 8, data.end);
    const key = item.type.replace(/^©/, '©');
    if (key === 'covr') {
      if (!out.picture && val.length > 64) out.picture = { mime: kind === 14 ? 'image/png' : 'image/jpeg', data: val.slice() };
      continue;
    }
    if (key === 'trkn') { if (val.length >= 4) out.track = (val[2] << 8) | val[3]; continue; }
    const text = clean(td.decode(val));
    if (!text) continue;
    if (key === '©nam') out.title = text;
    else if (key === '©ART') out.artist = text;
    else if (key === 'aART') out.albumArtist = text;
    else if (key === '©alb') out.album = text;
    else if (key === '©day') out.year = text.slice(0, 4);
  }
  return out;
}

// ---------- WAV ----------
async function parseWav(file) {
  const out = {};
  let pos = 12;
  for (let n = 0; n < 64 && pos + 8 <= file.size; n++) {
    const h = await bytes(file, pos, pos + 12);
    const id = ascii(h, 0, 4);
    const size = le32(h, 4);
    if (id === 'LIST' && ascii(h, 8, 4) === 'INFO' && size < 1024 * 1024) {
      const b = await bytes(file, pos + 12, pos + 8 + size);
      let p = 0;
      const td = decoder('utf-8');
      while (p + 8 <= b.length) {
        const sid = ascii(b, p, 4);
        const slen = le32(b, p + 4);
        const text = clean(td.decode(b.subarray(p + 8, p + 8 + slen)));
        if (sid === 'INAM') out.title = text;
        else if (sid === 'IART') out.artist = text;
        else if (sid === 'IPRD') out.album = text;
        p += 8 + slen + (slen & 1);
      }
      break;
    }
    pos += 8 + size + (size & 1);
  }
  return out;
}

/** Baca tag dari file audio. Tidak pernah melempar error; kembalikan {} bila gagal. */
export async function readTags(file) {
  try {
    const head = await bytes(file, 0, 12);
    const sig = ascii(head, 0, 4);
    let tags = {};
    if (ascii(head, 0, 3) === 'ID3') tags = await parseId3v2(file);
    else if (sig === 'fLaC') tags = await parseFlac(file);
    else if (sig === 'OggS') tags = await parseOgg(file);
    else if (ascii(head, 4, 4) === 'ftyp') tags = await parseMp4(file);
    else if (sig === 'RIFF' && ascii(head, 8, 4) === 'WAVE') tags = await parseWav(file);
    if (!tags.title || !tags.artist) {
      const v1 = await parseId3v1(file);
      tags = { ...v1, ...tags };
    }
    return tags;
  } catch (err) {
    console.warn('Gagal membaca tag:', file.name, err);
    return {};
  }
}

const JUNK = /\s*[([](?:[^)\]]*?(?:official|lyric|lirik|audio|video|visuali[sz]er|music\s*video|mv|hd|hq|4k|full\s*album|cover\s*art)[^)\]]*?)[)\]]/gi;

/** Tebak judul & artis dari nama file, contoh: "01 - Artis - Judul (Official Audio).mp3". */
export function guessFromFilename(name) {
  let base = String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '');
  base = base.replace(/[_]+/g, ' ').replace(JUNK, '').replace(/\s+/g, ' ').trim();
  base = base.replace(/^\d{1,3}\s*[-.)]\s+/, '').replace(/^\d{1,2}\s+(?=\D)/, '');
  const parts = base.split(/\s+[-–—]\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { title: base || 'Tanpa judul' };
}

export function cleanTitle(t) {
  return String(t || '').replace(JUNK, '').replace(/\s+/g, ' ').trim();
}
