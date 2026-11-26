// Aksi pengguna: menu lagu, playlist, hapus, edit info.
import { store } from './store.js';
import { icon } from './icons.js';
import { esc, toast, openMenu, openModal, confirmDialog, promptDialog, coverHTML, hydrateCovers, fmtTime, closeAllOverlays, isMobile } from './ui.js';
import { processCover } from './importer.js';

export const ctx = { player: null };

export async function go(hash) {
  await closeAllOverlays();
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

export const artistHash = (name) => `#/artist/${encodeURIComponent(name)}`;
export const albumHash = (album, artist) => `#/album/${encodeURIComponent(album)}/${encodeURIComponent(artist || '')}`;

// ---------- Like ----------
export async function toggleLike(id) {
  const liked = await store.toggleLike(id);
  toast(liked ? 'Ditambahkan ke Lagu Disukai' : 'Dihapus dari Lagu Disukai');
}

// ---------- Playlist ----------
export async function createPlaylist(songIds = [], { open = true } = {}) {
  const n = store.playlists.size + 1;
  const name = await promptDialog('Buat playlist', { placeholder: `Playlist saya #${n}`, okLabel: 'Buat', label: 'Nama playlist' });
  if (!name) return null;
  const pl = await store.createPlaylist(name, songIds);
  toast(songIds.length ? `Playlist "${pl.name}" dibuat dengan ${songIds.length} lagu` : `Playlist "${pl.name}" dibuat`);
  if (open) go(`#/playlist/${pl.id}`);
  return pl;
}

export async function addToPlaylist(pid, ids) {
  const pl = store.playlists.get(pid);
  const added = await store.addToPlaylist(pid, ids);
  if (!pl) return;
  if (added === 0) toast(ids.length > 1 ? 'Semua lagu sudah ada di playlist ini' : `Sudah ada di "${pl.name}"`);
  else toast(`${added > 1 ? added + ' lagu' : 'Lagu'} ditambahkan ke "${pl.name}"`);
}

export function playlistSubmenu(ids) {
  const items = [{ icon: 'plus', label: 'Playlist baru…', onClick: () => createPlaylist(ids, { open: false }) }];
  const list = store.playlistList();
  if (list.length) items.push('-');
  list.forEach((pl) => items.push({ icon: 'note', label: pl.name, hint: `${pl.songIds.length}`, onClick: () => addToPlaylist(pl.id, ids) }));
  return items;
}

export async function renamePlaylist(id) {
  const pl = store.playlists.get(id);
  if (!pl) return;
  const name = await promptDialog('Ganti nama playlist', { value: pl.name, label: 'Nama playlist' });
  if (name) { await store.renamePlaylist(id, name); toast('Nama playlist diperbarui'); }
}

export async function deletePlaylist(id) {
  const pl = store.playlists.get(id);
  if (!pl) return;
  const ok = await confirmDialog('Hapus playlist?', `Playlist <b>${esc(pl.name)}</b> akan dihapus. Lagu-lagunya tetap ada di Pustaka.`, { okLabel: 'Hapus', danger: true });
  if (!ok) return;
  await store.deletePlaylist(id);
  toast('Playlist dihapus');
  if (location.hash === `#/playlist/${id}`) go('#/library');
}

export async function removeFromPlaylist(pid, ids) {
  const pl = store.playlists.get(pid);
  if (!pl) return;
  const before = pl.songIds.slice();
  await store.removeFromPlaylist(pid, ids);
  toast(ids.length > 1 ? `${ids.length} lagu dihapus dari playlist` : 'Dihapus dari playlist', {
    action: { label: 'Urungkan', fn: () => { const cur = store.playlists.get(pid); if (cur) store.savePlaylist({ ...cur, songIds: before }); } },
  });
}

export function playlistMenu(anchor, id) {
  const pl = store.playlists.get(id);
  if (!pl) return;
  const ids = store.playlistSongs(id).map((s) => s.id);
  openMenu(anchor, [
    { icon: 'play', label: 'Putar', onClick: () => ctx.player.playList(ids, 0, { type: 'playlist', id, label: pl.name }, { shuffle: false }), disabled: !ids.length },
    { icon: 'shuffle', label: 'Putar acak', onClick: () => ctx.player.playList(ids, -1, { type: 'playlist', id, label: pl.name }, { shuffle: true }), disabled: !ids.length },
    { icon: 'playNext', label: 'Putar berikutnya', onClick: () => { ctx.player.playNext(ids); toast('Akan diputar berikutnya'); }, disabled: !ids.length },
    { icon: 'queueAdd', label: 'Tambah ke antrean', onClick: () => { ctx.player.addToQueue(ids); toast('Ditambahkan ke antrean'); }, disabled: !ids.length },
    '-',
    { icon: 'plus', label: 'Tambah lagu ke playlist', onClick: () => addSongsToPlaylistDialog(id) },
    { icon: 'edit', label: 'Ganti nama', onClick: () => renamePlaylist(id) },
    { icon: 'trash', label: 'Hapus playlist', danger: true, onClick: () => deletePlaylist(id) },
  ], { header: `<strong>${esc(pl.name)}</strong><small>${pl.songIds.length} lagu</small>` });
}

/** Dialog memilih lagu dari pustaka untuk dimasukkan ke playlist. */
export function addSongsToPlaylistDialog(pid) {
  const pl = store.playlists.get(pid);
  if (!pl) return;
  const inPl = new Set(pl.songIds);
  const songs = store.all().filter((s) => !inPl.has(s.id)).sort((a, b) => a.title.localeCompare(b.title, 'id'));
  const picked = new Set();
  const listHTML = (q) => {
    const qq = q.trim().toLowerCase();
    const rows = songs.filter((s) => !qq || `${s.title} ${s.artist} ${s.album}`.toLowerCase().includes(qq));
    if (!songs.length) return '<p class="muted pad">Semua lagu di pustaka sudah ada di playlist ini.</p>';
    if (!rows.length) return '<p class="muted pad">Tidak ada lagu yang cocok.</p>';
    return rows.map((s) => `
      <label class="pick-row">
        <input type="checkbox" value="${esc(s.id)}" ${picked.has(s.id) ? 'checked' : ''}>
        ${coverHTML(s, 'sm')}
        <span class="pick-text"><b>${esc(s.title)}</b><small>${esc(s.artist)}</small></span>
        <span class="pick-dur">${s.duration ? fmtTime(s.duration) : '—'}</span>
      </label>`).join('');
  };
  openModal({
    title: `Tambah ke "${pl.name}"`,
    wide: true,
    body: `
      <div class="search-box sm">${icon('search')}<input type="search" class="input-bare" placeholder="Cari di pustaka…" id="pickQ"></div>
      <div class="pick-list" id="pickList">${listHTML('')}</div>
      <p class="pick-alt">Lagu belum ada? <button class="link-btn" data-act="import-to-playlist" data-id="${esc(pid)}">Tambah file dari perangkat langsung ke playlist ini</button></p>`,
    actions: [
      { label: 'Batal', kind: 'ghost' },
      { label: 'Tambahkan', kind: 'primary', onClick: async () => {
        if (!picked.size) { toast('Pilih minimal satu lagu'); return false; }
        await addToPlaylist(pid, [...picked]);
        return true;
      } },
    ],
    onOpen: (root) => {
      const list = root.querySelector('#pickList');
      const btn = root.querySelector('.modal-actions .primary');
      const sync = () => { btn.textContent = picked.size ? `Tambahkan (${picked.size})` : 'Tambahkan'; };
      hydrateCovers(list);
      root.querySelector('#pickQ').addEventListener('input', (e) => { list.innerHTML = listHTML(e.target.value); hydrateCovers(list); });
      list.addEventListener('change', (e) => {
        if (e.target.type !== 'checkbox') return;
        if (e.target.checked) picked.add(e.target.value); else picked.delete(e.target.value);
        sync();
      });
    },
  });
}

// ---------- Hapus lagu ----------
export async function deleteSongs(ids) {
  ids = ids.filter((id) => store.get(id));
  if (!ids.length) return false;
  const one = ids.length === 1 ? store.get(ids[0]) : null;
  const msg = one
    ? `<b>${esc(one.title)}</b> — ${esc(one.artist)}<br>akan dihapus dari perangkat ini dan dari semua playlist.`
    : `<b>${ids.length} lagu</b> akan dihapus dari perangkat ini dan dari semua playlist.`;
  const ok = await confirmDialog(one ? 'Hapus lagu?' : `Hapus ${ids.length} lagu?`, msg, { okLabel: 'Hapus', danger: true });
  if (!ok) return false;
  await store.deleteSongs(ids);
  toast(one ? 'Lagu dihapus' : `${ids.length} lagu dihapus`);
  return true;
}

// ---------- Edit info ----------
export function editSong(id) {
  const s = store.get(id);
  if (!s) return;
  let newCover; // undefined = tidak berubah, null = hapus, Blob = baru
  let newColor = null;
  openModal({
    title: 'Edit info lagu',
    body: `
      <div class="edit-grid">
        <div class="edit-cover">
          <div id="editCover">${coverHTML(s, 'xl')}</div>
          <div class="edit-cover-btns">
            <button class="btn ghost sm" type="button" id="pickCover">${icon('image')} Ganti sampul</button>
            <button class="btn ghost sm" type="button" id="rmCover" ${s.hasCover ? '' : 'hidden'}>Hapus sampul</button>
          </div>
        </div>
        <div class="edit-fields">
          <label class="field"><span>Judul</span><input class="input" name="title" maxlength="200" value="${esc(s.title)}"></label>
          <label class="field"><span>Artis</span><input class="input" name="artist" maxlength="200" value="${esc(s.artist)}"></label>
          <label class="field"><span>Album</span><input class="input" name="album" maxlength="200" value="${esc(s.album)}"></label>
          <p class="muted small">${esc(s.fileName || '')}${s.source === 'url' ? ' · streaming' : s.source === 'youtube' ? ' · YouTube' : ''}</p>
        </div>
      </div>`,
    actions: [
      { label: 'Batal', kind: 'ghost' },
      { label: 'Simpan', kind: 'primary', onClick: async (root) => {
        const v = (n) => root.querySelector(`[name=${n}]`).value.trim();
        const title = v('title');
        if (!title) { toast('Judul tidak boleh kosong'); return false; }
        await store.updateSong(id, { title, artist: v('artist') || 'Artis tidak dikenal', album: v('album') });
        if (newCover !== undefined) await store.setCover(id, newCover, newColor);
        toast('Info lagu disimpan');
        return true;
      } },
    ],
    onOpen: (root) => {
      hydrateCovers(root);
      const input = document.getElementById('coverInput');
      root.querySelector('#pickCover').addEventListener('click', () => {
        input.value = '';
        input.onchange = async () => {
          const f = input.files[0];
          if (!f) return;
          try {
            const res = await processCover(f);
            newCover = res.blob;
            newColor = res.color;
            const url = URL.createObjectURL(res.blob);
            root.querySelector('#editCover').innerHTML = `<div class="cv xl" style="--c:${res.color}"><img class="ok" src="${url}" alt=""></div>`;
            root.querySelector('#rmCover').hidden = false;
          } catch { toast('Gambar tidak bisa dibaca'); }
        };
        input.click();
      });
      root.querySelector('#rmCover').addEventListener('click', (e) => {
        newCover = null;
        newColor = null;
        root.querySelector('#editCover').innerHTML = `<div class="cv xl" style="--c:${esc(s.color)}">${icon('note')}</div>`;
        e.currentTarget.hidden = true;
      });
    },
  });
}

export function songInfo(id) {
  const s = store.get(id);
  if (!s) return;
  const row = (k, v) => (v ? `<div class="info-row"><span>${k}</span><b>${esc(v)}</b></div>` : '');
  const size = s.size ? `${(s.size / 1048576).toFixed(1).replace('.', ',')} MB` : '';
  openModal({
    title: 'Info lagu',
    body: `<div class="info-list">
      ${row('Judul', s.title)}${row('Artis', s.artist)}${row('Album', s.album)}${row('Tahun', s.year)}
      ${row('Durasi', s.duration ? fmtTime(s.duration) : '')}${row(s.source === 'youtube' ? 'Judul video' : 'Nama file', s.fileName)}${row('Ukuran', size)}
      ${row('Sumber', s.source === 'youtube' ? 'YouTube (butuh internet)' : s.source === 'url' ? 'Link (streaming)' : 'Tersimpan di perangkat')}${s.source !== 'file' ? row('Link', s.url) : ''}
      ${row('Diputar', `${s.playCount || 0} kali`)}${row('Ditambahkan', new Date(s.addedAt).toLocaleString('id-ID'))}
    </div>`,
    actions: [{ label: 'Tutup', kind: 'primary' }],
  });
}

// ---------- Menu lagu ----------
export function songMenu(anchor, id, opts = {}) {
  const s = store.get(id);
  if (!s) return;
  const p = ctx.player;
  const items = [];
  if (opts.queueIndex !== undefined) {
    items.push({ icon: 'close', label: 'Hapus dari antrean', onClick: () => p.removeAt(opts.queueIndex) });
  } else {
    items.push({ icon: 'playNext', label: 'Putar berikutnya', onClick: () => { p.playNext([id]); toast('Akan diputar berikutnya'); } });
    items.push({ icon: 'queueAdd', label: 'Tambah ke antrean', onClick: () => { p.addToQueue([id]); toast('Ditambahkan ke antrean'); } });
  }
  items.push({ icon: 'listPlus', label: 'Tambah ke playlist', sub: () => playlistSubmenu([id]) });
  items.push({ icon: s.liked ? 'heartFill' : 'heart', label: s.liked ? 'Hapus dari Lagu Disukai' : 'Simpan ke Lagu Disukai', onClick: () => toggleLike(id) });
  items.push('-');
  items.push({ icon: 'user', label: 'Lihat artis', onClick: () => go(artistHash(s.artist)) });
  if (s.album) items.push({ icon: 'disc', label: 'Lihat album', onClick: () => go(albumHash(s.album, s.albumArtist || s.artist)) });
  if (s.source === 'youtube') items.push({ icon: 'link', label: 'Buka di YouTube', onClick: () => window.open(s.url, '_blank', 'noopener') });
  items.push({ icon: 'edit', label: 'Edit info lagu', onClick: () => editSong(id) });
  items.push({ icon: 'info', label: 'Info lagu', onClick: () => songInfo(id) });
  items.push('-');
  if (opts.playlistId) items.push({ icon: 'close', label: 'Hapus dari playlist ini', onClick: () => removeFromPlaylist(opts.playlistId, [id]) });
  items.push({ icon: 'trash', label: 'Hapus lagu dari perangkat', danger: true, onClick: () => deleteSongs([id]) });
  const header = isMobile() || opts.header ? `${coverHTML(s, 'sm')}<span><strong>${esc(s.title)}</strong><small>${esc(s.artist)}</small></span>` : '';
  openMenu(anchor, items, { header });
  hydrateCovers(document.getElementById('layer'));
}

// ---------- Banyak lagu sekaligus (mode pilih) ----------
export function multiMenu(anchor, ids, opts = {}) {
  const p = ctx.player;
  const items = [
    { icon: 'play', label: 'Putar', onClick: () => p.playList(ids, 0, { type: 'queue', id: null, label: 'Pilihan' }, { shuffle: false }) },
    { icon: 'playNext', label: 'Putar berikutnya', onClick: () => { p.playNext(ids); toast(`${ids.length} lagu akan diputar berikutnya`); } },
    { icon: 'queueAdd', label: 'Tambah ke antrean', onClick: () => { p.addToQueue(ids); toast(`${ids.length} lagu ditambahkan ke antrean`); } },
    { icon: 'listPlus', label: 'Tambah ke playlist', sub: () => playlistSubmenu(ids) },
    { icon: 'heart', label: 'Simpan ke Lagu Disukai', onClick: async () => {
      for (const id of ids) { const s = store.get(id); if (s && !s.liked) await store.updateSong(id, { liked: true, likedAt: Date.now() }); }
      toast(`${ids.length} lagu disimpan ke Lagu Disukai`);
    } },
  ];
  if (opts.playlistId) items.push('-', { icon: 'close', label: 'Hapus dari playlist ini', onClick: () => { removeFromPlaylist(opts.playlistId, ids); opts.done && opts.done(); } });
  items.push('-', { icon: 'trash', label: `Hapus ${ids.length} lagu dari perangkat`, danger: true, onClick: async () => { if (await deleteSongs(ids)) opts.done && opts.done(); } });
  openMenu(anchor, items, { header: `<strong>${ids.length} lagu dipilih</strong>` });
}
