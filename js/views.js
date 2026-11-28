// Halaman-halaman aplikasi (dirender sebagai HTML string).
import { store } from './store.js';
import { icon } from './icons.js';
import { esc, fmtTime, fmtTotal, fmtDate, fmtBytes, coverHTML, likedCoverHTML, playlistCoverHTML } from './ui.js';
import { ctx, artistHash, albumHash } from './actions.js';

export const lists = {}; // kunci daftar -> { ids, context, playlistId }
export const viewState = { selecting: false, selected: new Set(), libFilter: '', searchQ: '' };

const APP_NAME = 'Lagu Syarafat';

// ---------- Pengelompokan ----------
export function artistsOf() {
  const m = new Map();
  for (const s of store.all()) {
    const k = s.artist || 'Artis tidak dikenal';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s);
  }
  return [...m.entries()].map(([name, songs]) => ({ name, songs })).sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

export function albumsOf() {
  const m = new Map();
  for (const s of store.all()) {
    if (!s.album) continue;
    const artist = s.albumArtist || s.artist;
    const k = s.album + '\u0000' + artist;
    if (!m.has(k)) m.set(k, { name: s.album, artist, songs: [] });
    m.get(k).songs.push(s);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

const coll = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });
const sorters = {
  added: (a, b) => b.addedAt - a.addedAt,
  title: (a, b) => coll.compare(a.title, b.title),
  artist: (a, b) => coll.compare(a.artist, b.artist) || coll.compare(a.title, b.title),
  folder: (a, b) => coll.compare(a.folder || '\uffff', b.folder || '\uffff') || coll.compare(a.fileName || a.title, b.fileName || b.title),
  album: (a, b) => (a.album || '￿').localeCompare(b.album || '￿', 'id') || (a.track || 0) - (b.track || 0),
  plays: (a, b) => (b.playCount || 0) - (a.playCount || 0) || b.lastPlayed - a.lastPlayed,
  duration: (a, b) => (b.duration || 0) - (a.duration || 0),
};
export const sortLabels = { added: 'Terbaru ditambahkan', title: 'Judul (A–Z)', artist: 'Artis (A–Z)', folder: 'Folder', album: 'Album', plays: 'Paling sering diputar', duration: 'Durasi terpanjang' };

function totalDuration(songs) { return songs.reduce((a, s) => a + (s.duration || 0), 0); }

function matchQ(s, q) {
  return `${s.title} ${s.artist} ${s.album}`.toLowerCase().includes(q);
}

export function sameContext(a, b) {
  return a && b && a.type === b.type && (a.id || null) === (b.id || null);
}

// ---------- Komponen ----------
function row(s, i, opts) {
  const cur = ctx.player && ctx.player.currentId === s.id;
  const sel = viewState.selected.has(s.id);
  return `
  <div class="row${cur ? ' playing' : ''}${sel ? ' sel' : ''}" data-id="${esc(s.id)}" data-i="${i}" data-act="row" tabindex="0">
    <div class="c-num"><span class="n">${opts.numbers === 'track' && s.track ? s.track : i + 1}</span><span class="eq"><i></i><i></i><i></i></span><span class="pi">${icon('play')}</span><span class="chk">${icon('check')}</span></div>
    <div class="c-main">${coverHTML(s, 'sm')}<div class="c-text"><div class="t">${esc(s.title)}</div><div class="a">${s.liked ? `<span class="liked-dot">${icon('heartFill')}</span>` : ''}${s.source === 'url' ? `<span class="badge">LINK</span>` : s.source === 'youtube' ? `<span class="badge yt">YT</span>` : ''}${esc(s.artist)}</div></div></div>
    <div class="c-album">${opts.showFolder ? (s.folder ? `<span class="folder-tag">${icon('folder')}${esc(s.folder)}</span>` : '<span class="muted">—</span>') : s.album ? `<a href="${albumHash(s.album, s.albumArtist || s.artist)}" class="sublink" data-stop>${esc(s.album)}</a>` : '<span class="muted">—</span>'}</div>
    <div class="c-added">${esc(fmtDate(s.addedAt))}</div>
    <button class="icon-btn sm c-like${s.liked ? ' on' : ''}" data-act="like" data-id="${esc(s.id)}" aria-label="Suka">${icon(s.liked ? 'heartFill' : 'heart')}</button>
    <div class="c-dur">${s.duration ? fmtTime(s.duration) : '—'}</div>
    <button class="icon-btn sm c-more" data-act="song-menu" data-id="${esc(s.id)}" aria-label="Lainnya">${icon('more')}</button>
  </div>`;
}

export function tracklist(songs, key, context, opts = {}) {
  lists[key] = { ids: songs.map((s) => s.id), context, playlistId: opts.playlistId || null };
  const cls = ['tracklist'];
  if (opts.noAlbum) cls.push('no-album');
  if (opts.noAdded) cls.push('no-added');
  if (viewState.selecting && opts.selectable) cls.push('selecting');
  return `
  <div class="${cls.join(' ')}" data-list="${key}">
    ${opts.header === false ? '' : `<div class="row head"><div class="c-num">#</div><div class="c-main">Judul</div><div class="c-album">${opts.showFolder ? 'Folder' : 'Album'}</div><div class="c-added">Ditambahkan</div><div></div><div class="c-dur">${icon('clock')}</div><div></div></div>`}
    ${songs.map((s, i) => row(s, i, opts)).join('')}
  </div>`;
}

function songCard(s, key, i) {
  return `
  <div class="card" data-act="play-from" data-list="${key}" data-i="${i}" tabindex="0">
    <div class="card-art">${coverHTML(s)}<button class="play-btn card-play" data-act="play-from" data-list="${key}" data-i="${i}" aria-label="Putar">${icon('play')}</button></div>
    <div class="card-title">${esc(s.title)}</div>
    <div class="card-sub">${esc(s.artist)}</div>
  </div>`;
}

function playlistCard(pl) {
  const songs = store.playlistSongs(pl.id);
  return `
  <div class="card" data-href="#/playlist/${esc(pl.id)}" tabindex="0">
    <div class="card-art">${playlistCoverHTML(pl, songs)}${songs.length ? `<button class="play-btn card-play" data-act="play-playlist" data-id="${esc(pl.id)}" aria-label="Putar">${icon('play')}</button>` : ''}</div>
    <div class="card-title">${esc(pl.name)}</div>
    <div class="card-sub">Playlist · ${songs.length} lagu</div>
  </div>`;
}

function likedCard() {
  const n = store.liked().length;
  return `
  <div class="card" data-href="#/liked" tabindex="0">
    <div class="card-art">${likedCoverHTML()}${n ? `<button class="play-btn card-play" data-act="play-liked" aria-label="Putar">${icon('play')}</button>` : ''}</div>
    <div class="card-title">Lagu Disukai</div>
    <div class="card-sub">Playlist · ${n} lagu</div>
  </div>`;
}

function artistCard(a) {
  const withCover = a.songs.find((s) => s.hasCover) || a.songs[0];
  return `
  <div class="card artist" data-href="${artistHash(a.name)}" tabindex="0">
    <div class="card-art round">${coverHTML(withCover)}</div>
    <div class="card-title">${esc(a.name)}</div>
    <div class="card-sub">Artis · ${a.songs.length} lagu</div>
  </div>`;
}

function albumCard(al) {
  const withCover = al.songs.find((s) => s.hasCover) || al.songs[0];
  return `
  <div class="card" data-href="${albumHash(al.name, al.artist)}" tabindex="0">
    <div class="card-art">${coverHTML(withCover)}</div>
    <div class="card-title">${esc(al.name)}</div>
    <div class="card-sub">${esc(al.artist)}</div>
  </div>`;
}

function shelf(title, cards, more = '') {
  if (!cards.length) return '';
  return `<section class="shelf-sec"><div class="sec-head"><h2>${title}</h2>${more}</div><div class="shelf">${cards.join('')}</div></section>`;
}

function hero({ kind, title, sub, cover, color, round = false }) {
  return `
  <div class="hero-bg" style="--c:${esc(color || 'var(--panel-2)')}"></div>
  <section class="hero">
    <button class="icon-btn back-fab" data-act="back" aria-label="Kembali">${icon('back')}</button>
    <div class="hero-cover${round ? ' round' : ''}">${cover}</div>
    <div class="hero-info">
      <small>${esc(kind)}</small>
      <h1 class="${title.length > 28 ? 'long' : ''}">${esc(title)}</h1>
      <p>${sub}</p>
    </div>
  </section>`;
}

function actionBar(key, { menuAct = '', menuId = '', canSelect = true, extra = '' } = {}) {
  const l = lists[key];
  const empty = !l || !l.ids.length;
  const active = l && ctx.player && sameContext(ctx.player.context, l.context) && ctx.player.isPlaying;
  return `
  <div class="action-bar">
    <button class="play-btn big" data-act="play-list" data-list="${key}" data-ctx-key="${key}" ${empty ? 'disabled' : ''} aria-label="Putar">${icon(active ? 'pause' : 'play')}</button>
    <button class="icon-btn lg" data-act="shuffle-list" data-list="${key}" ${empty ? 'disabled' : ''} title="Putar acak" aria-label="Putar acak">${icon('shuffle')}</button>
    ${extra}
    ${canSelect && !empty ? `<button class="icon-btn lg" data-act="sel-start" title="Pilih lagu" aria-label="Pilih lagu">${icon('select')}</button>` : ''}
    ${menuAct ? `<button class="icon-btn lg" data-act="${menuAct}" data-id="${esc(menuId)}" title="Lainnya" aria-label="Lainnya">${icon('more')}</button>` : ''}
  </div>`;
}

export function selectBar(key) {
  if (!viewState.selecting) return '';
  return `
  <div class="select-bar" data-list="${key}">
    <button class="icon-btn" data-act="sel-cancel" aria-label="Batal pilih">${icon('close')}</button>
    <span class="sel-count"><b id="selCount">${viewState.selected.size}</b> dipilih</span>
    <button class="btn ghost sm" data-act="sel-all" data-list="${key}">Pilih semua</button>
    <span class="grow"></span>
    <button class="icon-btn" data-act="sel-playlist" title="Tambah ke playlist" aria-label="Tambah ke playlist">${icon('listPlus')}</button>
    <button class="icon-btn danger" data-act="sel-delete" data-list="${key}" title="Hapus" aria-label="Hapus">${icon('trash')}</button>
    <button class="icon-btn" data-act="sel-more" data-list="${key}" title="Lainnya" aria-label="Lainnya">${icon('more')}</button>
  </div>`;
}

function emptyState({ ic = 'note', title, text, actions = '' }) {
  return `<div class="empty"><div class="empty-ic">${icon(ic)}</div><h3>${title}</h3><p>${text}</p>${actions ? `<div class="btn-row">${actions}</div>` : ''}</div>`;
}

const addButtons = `
  <button class="btn primary" data-act="pick-files">${icon('upload')} Pilih lagu / video</button>
  <a class="btn ghost" href="#/sources">${icon('globe')} Dari mana dapat lagu?</a>`;

// ---------- Beranda ----------
function greeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

export function homeView() {
  const all = store.all();
  const head = `
    <header class="page-head home-head">
      <h1>${greeting()}</h1>
      <div class="head-actions">
        <button class="chip install-chip" data-act="install" hidden>${icon('install')} Pasang aplikasi</button>
        <a class="icon-btn mobile-only" href="#/settings" aria-label="Pengaturan">${icon('settings')}</a>
      </div>
    </header>`;
  if (!all.length) {
    return {
      title: 'Beranda',
      html: `${head}
      <section class="welcome">
        <div class="welcome-art">${icon('wave')}</div>
        <h2>Selamat datang di ${APP_NAME}</h2>
        <p>Pemutar musik pribadimu: <b>tanpa iklan</b>, tanpa akun, dan bisa diputar <b>tanpa internet</b>. Semua lagu tersimpan di perangkat ini. Punya video musik? Masukkan saja — otomatis diubah jadi MP3.</p>
        <div class="btn-row center">${addButtons}</div>
        <ol class="steps">
          <li><span><b>Tambah lagu</b> dari file MP3 di HP/laptop — atau pilih <b>video</b>, otomatis diubah jadi MP3.</span></li>
          <li><span><b>Buat playlist</b> dan tandai lagu favorit dengan ${icon('heart')}.</span></li>
          <li><span><b>Pasang aplikasi</b> ke layar utama supaya terasa seperti aplikasi biasa.</span></li>
        </ol>
      </section>`,
    };
  }
  const recent = store.recentlyPlayed(12);
  const added = store.recentlyAdded(12);
  const pls = store.playlistList();
  const artists = artistsOf().sort((a, b) => b.songs.length - a.songs.length).slice(0, 12);
  lists.recent = { ids: recent.map((s) => s.id), context: { type: 'recent', id: null, label: 'Terakhir diputar' } };
  lists.added = { ids: added.map((s) => s.id), context: { type: 'new', id: null, label: 'Baru ditambahkan' } };
  lists.all = { ids: all.sort(sorters.added).map((s) => s.id), context: { type: 'library', id: null, label: 'Semua lagu' } };

  const tile = (href, cover, name, play) => `
    <div class="tile" data-href="${href}" tabindex="0">${cover}<span>${esc(name)}</span>${play ? `<button class="play-btn tile-play" ${play} aria-label="Putar">${icon('play')}</button>` : ''}</div>`;
  const tiles = [
    tile('#/liked', likedCoverHTML('tile-cv'), 'Lagu Disukai', store.liked().length ? 'data-act="play-liked"' : ''),
    tile('#/library', `<div class="cv tile-cv all-cv">${icon('library')}</div>`, 'Semua lagu', 'data-act="play-list" data-list="all"'),
    ...pls.slice(0, 4).map((pl) => tile(`#/playlist/${esc(pl.id)}`, playlistCoverHTML(pl, store.playlistSongs(pl.id), 'tile-cv'), pl.name, pl.songIds.length ? `data-act="play-playlist" data-id="${esc(pl.id)}"` : '')),
  ];

  return {
    title: 'Beranda',
    html: `${head}
      <div class="home-actions">
        <button class="btn primary" data-act="shuffle-list" data-list="all">${icon('shuffle')} Acak semua lagu</button>
        <button class="btn ghost" data-act="play-list" data-list="all">${icon('play')} Putar berurutan</button>
      </div>
      <div class="tiles">${tiles.join('')}</div>
      ${shelf('Terakhir diputar', recent.map((s, i) => songCard(s, 'recent', i)))}
      ${shelf('Baru ditambahkan', added.map((s, i) => songCard(s, 'added', i)), '<a class="sec-link" href="#/library">Lihat semua</a>')}
      ${shelf('Playlist kamu', [likedCard(), ...pls.map(playlistCard), `
        <div class="card new-card" data-act="new-playlist" tabindex="0"><div class="card-art"><div class="cv">${icon('plus')}</div></div><div class="card-title">Buat playlist</div><div class="card-sub">Kumpulkan lagu favoritmu</div></div>`])}
      ${shelf('Artis kamu', artists.map(artistCard))}
      <p class="foot-note">${icon('shield')} Tanpa iklan · tanpa pelacakan · ${all.length} lagu tersimpan di perangkat ini</p>`,
  };
}

// ---------- Cari ----------
export function searchView() {
  return {
    title: 'Cari',
    html: `
      <header class="page-head"><h1>Cari</h1></header>
      <div class="search-box big">${icon('search')}<input type="search" id="searchInput" class="input-bare" placeholder="Lagu, artis, atau album…" value="${esc(viewState.searchQ)}" autocomplete="off" enterkeyhint="search"><button class="icon-btn sm" data-act="search-clear" aria-label="Hapus" ${viewState.searchQ ? '' : 'hidden'}>${icon('close')}</button></div>
      <div id="searchResults">${searchResults(viewState.searchQ)}</div>`,
  };
}

export function searchResults(q) {
  const all = store.all();
  if (!all.length) return emptyState({ ic: 'search', title: 'Pustaka masih kosong', text: 'Tambahkan lagu dulu, nanti kamu bisa mencarinya di sini.', actions: addButtons });
  const qq = q.trim().toLowerCase();
  if (!qq) {
    const artists = artistsOf();
    const albums = albumsOf();
    return `
      <h2 class="sec-title">Jelajahi pustakamu</h2>
      <div class="browse-grid">
        ${artists.slice(0, 24).map((a) => `<div class="browse-tile" data-href="${artistHash(a.name)}" style="--c:${esc((a.songs.find((s) => s.hasCover) || a.songs[0]).color)}"><span>${esc(a.name)}</span><small>${a.songs.length} lagu</small></div>`).join('')}
      </div>
      ${shelf('Album', albums.slice(0, 20).map(albumCard))}`;
  }
  const songs = all.filter((s) => matchQ(s, qq)).sort((a, b) => {
    const at = a.title.toLowerCase().startsWith(qq) ? 0 : 1;
    const bt = b.title.toLowerCase().startsWith(qq) ? 0 : 1;
    return at - bt || a.title.localeCompare(b.title, 'id');
  });
  const artists = artistsOf().filter((a) => a.name.toLowerCase().includes(qq));
  const albums = albumsOf().filter((a) => a.name.toLowerCase().includes(qq) || a.artist.toLowerCase().includes(qq));
  const pls = store.playlistList().filter((p) => p.name.toLowerCase().includes(qq));
  if (!songs.length && !artists.length && !albums.length && !pls.length) {
    return emptyState({ ic: 'search', title: `Tidak ada hasil untuk "${esc(q)}"`, text: 'Coba kata kunci lain, atau periksa ejaannya.' });
  }
  return `
    ${songs.length ? `<h2 class="sec-title">Lagu</h2>${tracklist(songs.slice(0, 100), 'search', { type: 'search', id: q, label: `Pencarian "${q}"` }, { noAdded: true, header: false })}` : ''}
    ${shelf('Artis', artists.map(artistCard))}
    ${shelf('Album', albums.map(albumCard))}
    ${shelf('Playlist', pls.map(playlistCard))}`;
}

// ---------- Pustaka ----------
export function libraryView() {
  const tab = store.settings.libraryTab || 'songs';
  const chip = (id, label) => `<button class="chip${tab === id ? ' on' : ''}" data-act="lib-tab" data-tab="${id}">${label}</button>`;
  let body = '';
  const all = store.all();
  if (tab === 'songs') {
    const sort = store.settings.librarySort || 'added';
    const q = viewState.libFilter.trim().toLowerCase();
    const songs = all.filter((s) => !q || matchQ(s, q)).sort(sorters[sort] || sorters.added);
    const tl = songs.length
      ? tracklist(songs, 'library', { type: 'library', id: null, label: 'Semua lagu' }, { selectable: true, showFolder: sort === 'folder' })
      : all.length
        ? emptyState({ ic: 'search', title: 'Tidak ada yang cocok', text: 'Coba kata kunci lain.' })
        : emptyState({ ic: 'note', title: 'Belum ada lagu', text: 'Tambahkan lagu dari perangkatmu untuk mulai mendengarkan.', actions: addButtons });
    body = `
      ${all.length ? `
      <div class="lib-tools">
        <div class="search-box sm">${icon('search')}<input type="search" id="libFilter" class="input-bare" placeholder="Cari di pustaka" value="${esc(viewState.libFilter)}" autocomplete="off"></div>
        <label class="select-wrap">${icon('sort')}<select id="libSort" aria-label="Urutkan">${Object.entries(sortLabels).map(([k, v]) => `<option value="${k}"${k === sort ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <div class="lib-summary">
        <span>${songs.length} lagu · ${fmtTotal(totalDuration(songs))}</span>
        <span class="grow"></span>
        <button class="btn ghost sm" data-act="play-list" data-list="library" ${songs.length ? '' : 'disabled'}>${icon('play')} Putar</button>
        <button class="btn ghost sm" data-act="shuffle-list" data-list="library" ${songs.length ? '' : 'disabled'}>${icon('shuffle')} Acak</button>
        <button class="btn ghost sm" data-act="sel-start">${icon('select')} Pilih</button>
      </div>
      ${selectBar('library')}` : ''}
      ${tl}`;
  } else if (tab === 'playlists') {
    const pls = store.playlistList();
    body = `<div class="grid">
      ${likedCard()}
      ${pls.map(playlistCard).join('')}
      <div class="card new-card" data-act="new-playlist" tabindex="0"><div class="card-art"><div class="cv">${icon('plus')}</div></div><div class="card-title">Buat playlist</div><div class="card-sub">Kumpulkan lagu favoritmu</div></div>
    </div>`;
  } else if (tab === 'artists') {
    const artists = artistsOf();
    body = artists.length ? `<div class="grid">${artists.map(artistCard).join('')}</div>` : emptyState({ ic: 'user', title: 'Belum ada artis', text: 'Artis muncul otomatis dari lagu yang kamu tambahkan.' });
  } else if (tab === 'albums') {
    const albums = albumsOf();
    body = albums.length ? `<div class="grid">${albums.map(albumCard).join('')}</div>` : emptyState({ ic: 'disc', title: 'Belum ada album', text: 'Album muncul otomatis dari info (tag) di file lagu. Kamu juga bisa mengisinya lewat "Edit info lagu".' });
  }
  return {
    title: 'Pustaka',
    html: `
      <header class="page-head">
        <h1>Pustaka</h1>
        <div class="head-actions">
          <button class="icon-btn" data-act="new-playlist" title="Buat playlist" aria-label="Buat playlist">${icon('listPlus')}</button>
          <a class="icon-btn" href="#/add" title="Tambah lagu" aria-label="Tambah lagu">${icon('plus')}</a>
        </div>
      </header>
      <div class="chips">${chip('songs', 'Lagu')}${chip('playlists', 'Playlist')}${chip('artists', 'Artis')}${chip('albums', 'Album')}</div>
      ${body}`,
  };
}

// ---------- Lagu Disukai ----------
export function likedView() {
  const songs = store.liked();
  const context = { type: 'liked', id: null, label: 'Lagu Disukai' };
  const tl = tracklist(songs, 'liked', context, { selectable: true });
  return {
    title: 'Lagu Disukai',
    html: `
      ${hero({ kind: 'Playlist', title: 'Lagu Disukai', sub: `${songs.length} lagu · ${fmtTotal(totalDuration(songs))}`, cover: likedCoverHTML('xl'), color: 'var(--accent-deep)' })}
      ${actionBar('liked')}
      ${selectBar('liked')}
      ${songs.length ? tl : emptyState({ ic: 'heart', title: 'Lagu yang kamu sukai muncul di sini', text: `Ketuk ${icon('heart')} pada lagu untuk menyimpannya di sini.`, actions: '<a class="btn primary" href="#/library">Buka Pustaka</a>' })}`,
  };
}

// ---------- Playlist ----------
export function playlistView(id) {
  const pl = store.playlists.get(id);
  if (!pl) return notFound('Playlist tidak ditemukan', 'Mungkin sudah dihapus.');
  const songs = store.playlistSongs(id);
  const first = songs.find((s) => s.hasCover) || songs[0];
  const context = { type: 'playlist', id, label: pl.name };
  const tl = tracklist(songs, 'playlist', context, { selectable: true, playlistId: id });
  return {
    title: pl.name,
    html: `
      ${hero({ kind: 'Playlist', title: pl.name, sub: `${songs.length} lagu${songs.length ? ' · ' + fmtTotal(totalDuration(songs)) : ''}`, cover: playlistCoverHTML(pl, songs, 'xl'), color: first ? first.color : null })}
      ${actionBar('playlist', { menuAct: 'playlist-menu', menuId: id, extra: `<button class="icon-btn lg" data-act="playlist-add" data-id="${esc(id)}" title="Tambah lagu" aria-label="Tambah lagu">${icon('plusCircle')}</button>` })}
      ${selectBar('playlist')}
      ${songs.length ? tl : emptyState({ ic: 'listPlus', title: 'Playlist ini masih kosong', text: 'Tambahkan lagu dari pustaka atau langsung dari file di perangkatmu.', actions: `<button class="btn primary" data-act="playlist-add" data-id="${esc(id)}">${icon('plus')} Tambah lagu</button><button class="btn ghost" data-act="import-to-playlist" data-id="${esc(id)}">${icon('upload')} Dari perangkat</button>` })}`,
  };
}

// ---------- Artis & Album ----------
export function artistView(name) {
  const songs = store.all().filter((s) => (s.artist || 'Artis tidak dikenal') === name)
    .sort((a, b) => (b.playCount || 0) - (a.playCount || 0) || a.title.localeCompare(b.title, 'id'));
  if (!songs.length) return notFound('Artis tidak ditemukan', 'Mungkin semua lagunya sudah dihapus.');
  const first = songs.find((s) => s.hasCover) || songs[0];
  const albums = albumsOf().filter((a) => a.artist === name || a.songs.some((s) => s.artist === name));
  const context = { type: 'artist', id: name, label: name };
  const tl = tracklist(songs, 'artist', context, { noAdded: true });
  return {
    title: name,
    html: `
      ${hero({ kind: 'Artis', title: name, sub: `${songs.length} lagu · ${fmtTotal(totalDuration(songs))}`, cover: coverHTML(first, 'xl'), color: first.color, round: true })}
      ${actionBar('artist', { canSelect: false })}
      <h2 class="sec-title">Lagu</h2>
      ${tl}
      ${shelf('Album', albums.map(albumCard))}`,
  };
}

export function albumView(album, artist) {
  const songs = store.all().filter((s) => s.album === album && (!artist || (s.albumArtist || s.artist) === artist))
    .sort((a, b) => (a.track || 999) - (b.track || 999) || a.title.localeCompare(b.title, 'id'));
  if (!songs.length) return notFound('Album tidak ditemukan', 'Mungkin semua lagunya sudah dihapus.');
  const first = songs.find((s) => s.hasCover) || songs[0];
  const year = songs.find((s) => s.year)?.year;
  const context = { type: 'album', id: album + '|' + artist, label: album };
  const tl = tracklist(songs, 'album', context, { noAlbum: true, noAdded: true, numbers: 'track' });
  return {
    title: album,
    html: `
      ${hero({ kind: 'Album', title: album, sub: `<a class="sublink strong" href="${artistHash(artist || first.artist)}">${esc(artist || first.artist)}</a>${year ? ' · ' + esc(year) : ''} · ${songs.length} lagu · ${fmtTotal(totalDuration(songs))}`, cover: coverHTML(first, 'xl'), color: first.color })}
      ${actionBar('album', { canSelect: false })}
      ${tl}`,
  };
}

function notFound(title, text) {
  return { title, html: emptyState({ ic: 'alert', title, text, actions: '<a class="btn primary" href="#/home">Ke Beranda</a>' }) };
}

// ---------- Tambah lagu ----------
export function addView() {
  return {
    title: 'Tambah Lagu',
    html: `
      <header class="page-head"><h1>Tambah Lagu</h1></header>
      <p class="lead">Lagu disimpan langsung di perangkat ini, jadi bisa diputar kapan saja <b>tanpa internet</b> dan <b>tanpa iklan</b>.</p>
      <div class="drop-zone" id="dropZone">
        <div class="dz-ic">${icon('upload')}</div>
        <strong class="desktop-only">Seret &amp; lepas lagu atau video ke sini</strong>
        <strong class="mobile-only">Pilih lagu atau video dari HP kamu</strong>
        <span class="muted desktop-only">atau</span>
        <div class="btn-row center">
          <button class="btn primary" data-act="pick-files">${icon('note')} Pilih lagu / video</button>
          <button class="btn ghost" data-act="pick-folder">${icon('folder')} Pilih folder</button>
        </div>
        <small class="muted">Bisa pilih banyak file, atau <b>beberapa folder</b> satu per satu — lagu di dalam subfolder ikut dicari. Lagu yang sudah ada otomatis dilewati.<br>Lagu: MP3, M4A, FLAC, WAV, OGG · Video: MP4, WEBM, MOV, MKV, 3GP</small>
      </div>
      <div id="stagedFolders"></div>
      <div class="convert-note">
        <div class="cn-ic">${icon('wave')}</div>
        <div><b>Video otomatis diubah jadi MP3.</b> Foto sampulnya diambil dulu dari video (foto sampul bawaan file, atau cuplikan paling jelas), lalu hanya suaranya yang disimpan — videonya tidak, jadi hemat memori. Prosesnya berjalan di HP-mu sendiri tanpa internet; biarkan aplikasi tetap terbuka sampai selesai.</div>
      </div>
      <div id="importBox"></div>

      <section class="panel" id="linkPanel">
        <h2>${icon('link')} Tambah dari link file</h2>
        <p class="muted">Punya link <b>langsung ke file lagu/video</b> (biasanya berakhiran <code>.mp3</code> atau <code>.mp4</code>)? Tempel di sini, bisa beberapa link sekaligus (satu per baris). Jika server mengizinkan, file diunduh (video diubah ke MP3) agar bisa diputar offline.</p>
        <form class="url-form" id="urlForm">
          <textarea class="input" id="urlInput" rows="2" placeholder="https://contoh.com/lagu.mp3" required autocomplete="off" spellcheck="false"></textarea>
          <button class="btn primary" type="submit">Tambah</button>
        </form>
      </section>

      <section class="panel">
        <h2>${icon('globe')} Dari mana dapat lagu?</h2>
        <p class="muted">Gunakan lagu milikmu sendiri, beli dari toko musik digital, atau unduh dari situs musik gratis yang legal seperti Jamendo, Free Music Archive, dan Internet Archive.</p>
        <a class="btn ghost" href="#/sources">Lihat panduan lengkap ${icon('chevronRight')}</a>
      </section>

      <section class="panel">
        <h2>${icon('info')} Tips</h2>
        <ul class="tips">
          <li><b>Di HP Android:</b> lagu biasanya ada di folder <i>Download</i>, <i>Music</i>, atau <i>WhatsApp/Media/WhatsApp Audio</i>; video di <i>DCIM</i>, <i>Movies</i>, atau <i>Download</i>.</li>
          <li><b>Pindah dari laptop ke HP:</b> pakai kabel USB, Quick Share/Nearby Share, atau unggah ke Google Drive lalu unduh di HP.</li>
          <li><b>Beberapa folder:</b> ketuk <i>Pilih folder</i>, pilih folder pertama, lalu ketuk <i>Folder lain</i> untuk menambah folder berikutnya. Setelah semua terkumpul, ketuk <i>Tambahkan</i>. Lagu diurutkan per folder dan nama file (1, 2, … 10).</li>
          <li><b>Tidak ada lagu dobel:</b> file yang sama dikenali dari isinya — walau namanya diganti atau ada di folder lain — dan otomatis dilewati.</li>
          <li><b>Di laptop:</b> seret banyak file atau beberapa folder sekaligus ke jendela aplikasi ini.</li>
          <li><b>Video di galeri HP:</b> pilih lewat tombol di atas — atau setelah aplikasi dipasang, buka video di Galeri/File lalu <i>Bagikan → ${APP_NAME}</i>.</li>
          <li><b>Lama proses video:</b> umumnya beberapa detik sampai ±1 menit per lagu, tergantung panjang video dan kecepatan HP.</li>
          <li>Judul, artis, album, dan sampul dibaca otomatis dari file. Bisa diubah lewat menu ${icon('more')} → <i>Edit info lagu</i>.</li>
        </ul>
      </section>`,
  };
}

// ---------- Panduan sumber lagu ----------
const src = (name, url, desc) => `
  <a class="source" href="${url}" target="_blank" rel="noopener noreferrer">
    <span class="source-text"><b>${name}</b><small>${desc}</small></span>${icon('chevronRight')}
  </a>`;

export function sourcesView() {
  return {
    title: 'Dari mana dapat lagu?',
    html: `
      <header class="page-head"><button class="icon-btn" data-act="back" aria-label="Kembali">${icon('back')}</button><h1>Dari mana dapat lagu?</h1></header>
      <p class="lead">Aplikasi ini memutar <b>file lagu</b> yang kamu simpan. Berikut tempat mendapatkannya secara legal.</p>

      <section class="panel">
        <h2>1. Lagu milikmu sendiri</h2>
        <ul class="tips">
          <li>File MP3/M4A yang sudah ada di HP atau laptop (folder <i>Download</i>, <i>Music</i>, <i>WhatsApp Audio</i>, dsb.).</li>
          <li>Lagu dari CD yang kamu rip sendiri, rekaman pribadi, atau file yang dibagikan langsung oleh musisinya.</li>
        </ul>
        <a class="btn primary" href="#/add">${icon('upload')} Tambah dari perangkat</a>
      </section>

      <section class="panel">
        <h2>2. Gratis &amp; legal</h2>
        <div class="sources">
          ${src('Jamendo Music', 'https://www.jamendo.com', 'Ribuan lagu musisi independen, bisa diunduh gratis untuk didengar pribadi.')}
          ${src('Free Music Archive', 'https://freemusicarchive.org', 'Musik berlisensi Creative Commons dari berbagai genre.')}
          ${src('Internet Archive — Audio', 'https://archive.org/details/audio', 'Rekaman domain publik, netlabel, dan arsip konser.')}
          ${src('Pixabay Music', 'https://pixabay.com/music/', 'Musik bebas royalti, unduh MP3 gratis.')}
          ${src('YouTube Audio Library', 'https://studio.youtube.com', 'Musik gratis dari YouTube (masuk YouTube Studio → Audio Library).')}
          ${src('ccMixter', 'https://ccmixter.org', 'Lagu & remix berlisensi Creative Commons.')}
        </div>
      </section>

      <section class="panel">
        <h2>3. Beli lagu (dukung musisinya)</h2>
        <div class="sources">
          ${src('Bandcamp', 'https://bandcamp.com', 'Beli langsung dari musisi, lalu unduh MP3/FLAC. Banyak musisi Indonesia juga.')}
          ${src('iTunes Store', 'https://www.apple.com/itunes/', 'Lagu yang dibeli bisa diunduh sebagai file M4A tanpa DRM.')}
        </div>
      </section>

      <section class="panel note">
        <h2>${icon('alert')} Perlu diketahui</h2>
        <ul class="tips">
          <li>Lagu yang "diunduh" di aplikasi langganan (Spotify, Joox, YouTube Music, Apple Music) terkunci DRM dan <b>tidak bisa</b> dipindahkan ke aplikasi lain.</li>
          <li>Hindari situs "download MP3 gratis" atau konverter YouTube: umumnya melanggar hak cipta dan penuh iklan atau malware.</li>
          <li>Punya link langsung ke file audio? Tempel di <a href="#/add">Tambah Lagu → Tambah dari link file</a>.</li>
          <li>Punya video musik di HP (rekaman konser, video dari teman, video yang kamu beli)? Tambahkan saja — otomatis diubah ke MP3.</li>
        </ul>
      </section>`,
  };
}

// ---------- Pengaturan ----------
export const ACCENTS = {
  violet: { name: 'Ungu', color: '#a78bfa' },
  pink: { name: 'Merah muda', color: '#f472b6' },
  blue: { name: 'Biru', color: '#60a5fa' },
  teal: { name: 'Toska', color: '#2dd4bf' },
  orange: { name: 'Oranye', color: '#fb923c' },
  yellow: { name: 'Kuning', color: '#facc15' },
};

export function settingsView() {
  const accent = store.settings.accent;
  const n = store.songs.size;
  return {
    title: 'Pengaturan',
    html: `
      <header class="page-head"><h1>Pengaturan</h1></header>

      <section class="panel">
        <h2>${icon('palette')} Warna aksen</h2>
        <div class="swatches">
          ${Object.entries(ACCENTS).map(([k, v]) => `<button class="swatch${k === accent ? ' on' : ''}" data-act="accent" data-accent="${k}" style="--sw:${v.color}" aria-label="${v.name}" title="${v.name}">${icon('check')}</button>`).join('')}
        </div>
      </section>

      <section class="panel">
        <h2>${icon('install')} Pasang sebagai aplikasi</h2>
        <p class="muted">Pasang ke layar utama supaya terbuka layar penuh seperti aplikasi biasa, bisa offline, dan kontrol musik muncul di layar kunci.</p>
        <button class="btn primary" data-act="install" hidden>${icon('download')} Pasang sekarang</button>
        <p class="installed-note" hidden>${icon('check')} Aplikasi sudah terpasang.</p>
        <ul class="tips">
          <li><b>Android (Chrome):</b> menu <b>⋮</b> → <i>Instal aplikasi</i> / <i>Tambahkan ke layar utama</i>.</li>
          <li><b>iPhone/iPad (Safari):</b> tombol <i>Bagikan</i> → <i>Tambah ke Layar Utama</i>.</li>
          <li><b>Laptop (Chrome/Edge):</b> klik ikon pasang di ujung kanan kolom alamat.</li>
        </ul>
      </section>

      <section class="panel">
        <h2>${icon('storage')} Penyimpanan</h2>
        <div class="storage" id="storageInfo">
          <div class="storage-bar"><div class="storage-fill" id="storageFill"></div></div>
          <p><b>${n} lagu</b> · <span id="storageUsed">${fmtBytes(store.totalBytes())}</span> <span class="muted" id="storageQuota"></span></p>
          <p class="muted small" id="persistNote">Memeriksa…</p>
          <button class="btn ghost sm" data-act="persist" id="persistBtn" hidden>Jaga lagu agar tidak terhapus otomatis</button>
        </div>
      </section>

      <section class="panel desktop-only">
        <h2>${icon('info')} Pintasan keyboard</h2>
        <div class="kbd-grid">
          <span><kbd>Spasi</kbd> Putar / jeda</span>
          <span><kbd>Ctrl</kbd> + <kbd>→</kbd> / <kbd>←</kbd> Lagu berikut / sebelumnya</span>
          <span><kbd>→</kbd> / <kbd>←</kbd> Maju / mundur 5 detik</span>
          <span><kbd>Ctrl</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd> Volume</span>
          <span><kbd>M</kbd> Bisukan</span>
          <span><kbd>S</kbd> Acak · <kbd>R</kbd> Ulangi</span>
          <span><kbd>L</kbd> Suka lagu ini</span>
          <span><kbd>/</kbd> Cari</span>
        </div>
      </section>

      <section class="panel">
        <h2>${icon('shield')} Lagu dobel</h2>
        <p class="muted">Lagu yang sama otomatis dilewati saat ditambahkan. Untuk membersihkan lagu dobel yang mungkin sudah tersimpan sebelumnya, ketuk tombol di bawah. Status suka, jumlah putar, dan playlist tetap dipertahankan.</p>
        <button class="btn ghost" data-act="dedupe" ${n ? '' : 'disabled'}>${icon('search')} Cek lagu dobel</button>
      </section>

      <section class="panel danger-zone">
        <h2>${icon('trash')} Hapus data</h2>
        <p class="muted">Menghapus semua lagu dan playlist dari perangkat ini. Tidak bisa dibatalkan.</p>
        <button class="btn danger" data-act="wipe" ${n || store.playlists.size ? '' : 'disabled'}>Hapus semua lagu &amp; playlist</button>
      </section>

      <section class="panel about">
        <img src="icons/icon.svg" alt="" width="48" height="48">
        <div>
          <b>${APP_NAME}</b> <span class="muted">versi 1.0</span>
          <p class="muted small">Tanpa iklan · tanpa akun · tanpa pelacakan. Semua lagu hanya tersimpan di perangkat ini dan tidak dikirim ke mana pun.</p>
        </div>
      </section>`,
  };
}
