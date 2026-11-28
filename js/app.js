// Titik awal aplikasi: routing, render halaman, event global.
import { store } from './store.js';
import { Player } from './player.js';
import { hydrateIcons, icon } from './icons.js';
import { $, $$, esc, toast, isMobile, hydrateCovers, confirmDialog, openModal, openMenu, fmtBytes, likedCoverHTML, playlistCoverHTML, coverHTML } from './ui.js';
const coverHTMLsafe = (s) => coverHTML(s, 'sm');
import * as A from './actions.js';
import * as V from './views.js';
import * as PUI from './playerui.js';
import { importFiles, importLinks, onImportStatus, isMediaFile, sortEntries, fingerprint } from './importer.js';
import { YTEngine } from './ytengine.js';

const view = $('#view');
const main = $('#main');
let route = { name: 'home', params: [] };
let player = null;
let deferredInstall = null;
let renderTimer = 0;

// ---------- Routing ----------
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, ...rest] = h.split('/');
  let params = [];
  try { params = rest.map(decodeURIComponent); } catch { params = rest; }
  return { name: name || 'home', params };
}

function buildView(r) {
  switch (r.name) {
    case 'search': return V.searchView();
    case 'library': return V.libraryView();
    case 'liked': return V.likedView();
    case 'playlist': return V.playlistView(r.params[0]);
    case 'artist': return V.artistView(r.params[0] || '');
    case 'album': return V.albumView(r.params[0] || '', r.params[1] || '');
    case 'add': return V.addView();
    case 'sources': return V.sourcesView();
    case 'settings': return V.settingsView();
    default: r.name = 'home'; return V.homeView();
  }
}

function renderView(keepScroll = false) {
  const res = buildView(route);
  const active = document.activeElement;
  const focusId = active && active.id && view.contains(active) ? active.id : null;
  let sel = null;
  if (focusId) { try { sel = [active.selectionStart, active.selectionEnd]; } catch { sel = null; } }
  const scroll = main.scrollTop;

  view.innerHTML = res.html;
  view.dataset.route = route.name;
  hydrateCovers(view);
  mountView();
  main.scrollTop = keepScroll ? scroll : 0;

  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel && sel[0] != null) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* abaikan */ } }
    }
  }
  const navName = ['playlist', 'liked', 'artist', 'album'].includes(route.name) ? 'library' : route.name === 'sources' ? 'add' : route.name;
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === navName));
  $$('.side-item').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === location.hash));
  PUI.markPlaying();
  updateInstallButtons();
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => { renderView(true); renderSidebar(); }, 120);
}

function mountView() {
  if (route.name === 'search') {
    const input = $('#searchInput');
    const clear = view.querySelector('[data-act="search-clear"]');
    let t = 0;
    input.addEventListener('input', () => {
      V.viewState.searchQ = input.value;
      clear.hidden = !input.value;
      clearTimeout(t);
      t = setTimeout(() => {
        $('#searchResults').innerHTML = V.searchResults(input.value);
        hydrateCovers($('#searchResults'));
        PUI.markPlaying();
      }, 90);
    });
    if (!isMobile() || !V.viewState.searchQ) setTimeout(() => input.focus({ preventScroll: true }), 30);
  }
  if (route.name === 'library') {
    const f = $('#libFilter');
    if (f) {
      let t = 0;
      f.addEventListener('input', () => {
        V.viewState.libFilter = f.value;
        clearTimeout(t);
        t = setTimeout(() => renderView(true), 140);
      });
    }
    const s = $('#libSort');
    if (s) s.addEventListener('change', () => { store.saveSettings({ librarySort: s.value }); renderView(true); });
  }
  if (route.name === 'add') {
    const form = $('#urlForm');
    const input = $('#urlInput');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Memeriksa…';
      try {
        await runLinkImport(input.value, (done, total) => {
          if (btn.isConnected && total > 1) btn.textContent = `${done}/${total}…`;
        });
        if (input.isConnected) input.value = '';
      } finally {
        if (btn.isConnected) { btn.disabled = false; btn.textContent = 'Tambah'; }
      }
    });
    renderImportStatus(lastStatus);
    renderStaged();
  }
  if (route.name === 'settings') fillStorageInfo();
}

// ---------- Sidebar ----------
function renderSidebar() {
  const pls = store.playlistList();
  const item = (href, cover, name, sub) => `
    <a class="side-item${location.hash === href ? ' active' : ''}" href="${href}">${cover}<span class="side-text"><b>${esc(name)}</b><small>${sub}</small></span></a>`;
  $('#sidePlaylists').innerHTML = [
    item('#/liked', likedCoverHTML('sm'), 'Lagu Disukai', `Playlist · ${store.liked().length} lagu`),
    ...pls.map((pl) => item(`#/playlist/${esc(pl.id)}`, playlistCoverHTML(pl, store.playlistSongs(pl.id), 'sm'), pl.name, `Playlist · ${pl.songIds.length} lagu`)),
  ].join('') + (pls.length ? '' : `<button class="side-empty" data-act="new-playlist">${icon('plus')}<span>Buat playlist pertamamu</span></button>`);
  hydrateCovers($('#sidePlaylists'));
}

// ---------- Impor ----------
let lastStatus = { running: false };
let hideStatusTimer = 0;

function statusHTML(st, big) {
  const part = st.running && st.note ? (st.pct || 0) / 100 : 0;
  const pct = st.total ? Math.min(100, Math.round(((st.done + part) / st.total) * 100)) : 0;
  const converting = st.running && st.note;
  const head = st.running
    ? (converting ? `${esc(st.note)}…${st.pct ? ` ${st.pct}%` : ''}` : `Menambahkan lagu… ${st.done} dari ${st.total}`)
    : 'Selesai';
  const detail = st.running
    ? `${st.total > 1 ? `${st.done + 1} dari ${st.total} · ` : ''}${esc(st.current)}`
    : `${st.added} ditambahkan${st.converted ? ` (${st.converted} dari video)` : ''}${st.dup ? ` · ${st.dup} sudah ada` : ''}${st.failed?.length ? ` · ${st.failed.length} gagal` : ''}`;
  return `
    <div class="imp${big ? ' big' : ''}${st.running && st.cover ? ' has-cover' : ''}">
      ${st.running && st.cover ? `<img class="imp-cover" src="${st.cover}" alt="Sampul">` : ''}
      <div class="imp-main">
        <div class="imp-head">${icon(st.running ? (converting ? 'wave' : 'upload') : 'check')}<b>${head}</b></div>
        <div class="imp-bar"><div style="width:${pct}%"></div></div>
        <small>${detail}</small>
      </div>
    </div>`;
}

function renderImportStatus(st) {
  const box = $('#importBox');
  if (box) box.innerHTML = st.running || st.total ? statusHTML(st, true) : '';
  const fl = $('#importStatus');
  if (st.running && route.name !== 'add') {
    fl.hidden = false;
    fl.innerHTML = statusHTML(st, false);
  } else if (!st.running) {
    clearTimeout(hideStatusTimer);
    if (!fl.hidden) hideStatusTimer = setTimeout(() => { fl.hidden = true; }, 1200);
  } else {
    fl.hidden = true;
  }
}

onImportStatus((st) => { lastStatus = st; renderImportStatus(st); });

async function runImport(files, opts = {}) {
  const summary = await importFiles(files, opts);
  if (summary.nothing) {
    toast(summary.skipped ? 'File yang dipilih bukan lagu atau video' : 'Tidak ada file yang dipilih', { kind: 'warn' });
    return summary;
  }
  const n = summary.added.length;
  const parts = [];
  if (n) parts.push(`${n} lagu ditambahkan${summary.converted ? ` (${summary.converted} dari video → MP3)` : ''}`);
  if (summary.dup) parts.push(`${summary.dup} dilewati karena sudah ada`);
  if (summary.failed.length) parts.push(`${summary.failed.length} gagal`);
  if (summary.skipped) parts.push(`${summary.skipped} bukan lagu/video`);
  const msg = parts.join(' · ') || 'Tidak ada lagu baru';
  if (opts.quiet) { if (n) requestPersist(); return summary; }
  if (summary.failed.length) {
    toast(msg, { kind: 'warn', action: { label: 'Detail', fn: () => showFailures(summary.failed) } });
  } else if (n && route.name !== 'library' && !opts.playlistId) {
    toast(msg, { action: { label: 'Lihat', fn: () => { store.saveSettings({ libraryTab: 'songs', librarySort: 'added' }); A.go('#/library'); } } });
  } else {
    toast(msg);
  }
  if (n) requestPersist();
  return summary;
}

async function runLinkImport(text, onProgress) {
  const r = await importLinks(text, onProgress);
  const n = r.added.length;
  const parts = [];
  if (n === 1) parts.push(`"${r.added[0].title}" ditambahkan`);
  else if (n) parts.push(`${n} lagu ditambahkan`);
  if (r.dup) parts.push(`${r.dup} sudah ada`);
  if (r.failed.length) {
    if (!n && !r.dup && r.failed.length === 1) {
      toast(r.failed[0].reason, { kind: 'warn', timeout: 7000 });
      return r;
    }
    parts.push(`${r.failed.length} gagal`);
    toast(parts.join(' · '), { kind: 'warn', action: { label: 'Detail', fn: () => showFailures(r.failed.map((f) => ({ name: f.link, reason: f.reason }))) } });
    return r;
  }
  if (parts.length) {
    const first = r.added[0];
    toast(parts.join(' · '), n ? { action: { label: 'Putar', fn: () => player.playList(r.added.map((x) => x.id), 0, { type: 'queue', id: null, label: 'Baru ditambahkan' }) } } : {});
    if (first) requestPersist();
  }
  return r;
}

function showFailures(list) {
  openModal({
    title: 'Lagu yang gagal ditambahkan',
    body: `<div class="info-list">${list.slice(0, 100).map((f) => `<div class="info-row"><span>${esc(f.name)}</span><b>${esc(f.reason)}</b></div>`).join('')}</div>
      <p class="muted small">Format paling aman: MP3/M4A untuk lagu, MP4/WEBM untuk video. Beberapa format (mis. WMA, AVI, ALAC di Android) tidak didukung browser.</p>`,
    actions: [{ label: 'Tutup', kind: 'primary' }],
  });
}

function pickFiles(opts = {}) {
  const input = $('#fileInput');
  input.value = '';
  input.onchange = () => { if (input.files.length) runImport([...input.files], opts); };
  input.click();
}

function pickFolder() {
  const input = $('#folderInput');
  input.value = '';
  input.onchange = () => {
    const files = [...input.files];
    if (!files.length) return;
    const groups = new Map();
    for (const f of files) {
      const rel = f.webkitRelativePath || f.name;
      const parts = rel.split('/');
      const root = parts.length > 1 ? parts[0] : 'Folder';
      const folder = parts.slice(0, -1).join('/') || root;
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push({ file: f, folder });
    }
    groups.forEach((entries, root) => stageFolder(root, entries));
  };
  input.click();
}

// ---------- Beberapa folder sekaligus ----------
const staged = []; // [{ key, name, entries, skipped }]

function stageFolder(name, entries) {
  const media = sortEntries(entries.filter((e) => isMediaFile(e.file)));
  const skipped = entries.length - media.length;
  const key = `${name}|${media.length}|${media.reduce((a, e) => a + e.file.size, 0)}`;
  if (staged.some((f) => f.key === key)) {
    toast(`Folder "${name}" sudah ada di daftar`);
    return;
  }
  staged.push({ key, name, entries: media, skipped });
  if (route.name !== 'add') A.go('#/add');
  else renderStaged();
  toast(media.length ? `Folder "${name}": ${media.length} lagu/video ditemukan` : `Folder "${name}" tidak berisi lagu atau video`, { kind: media.length ? '' : 'warn' });
}

function renderStaged() {
  const box = $('#stagedFolders');
  if (!box) return;
  if (!staged.length) { box.innerHTML = ''; return; }
  const all = staged.flatMap((f) => f.entries);
  const seen = new Set();
  let dupCount = 0;
  for (const e of all) {
    const k = `${e.file.name}|${e.file.size}`;
    if (seen.has(k) || store.findDuplicate(e.file.name, e.file.size)) dupCount++;
    seen.add(k);
  }
  const makePl = store.settings.folderPlaylists !== false;
  box.innerHTML = `
    <section class="staged">
      <div class="staged-head"><h3>${icon('folder')} Folder yang dipilih (${staged.length})</h3><button class="link-btn" data-act="unstage-all">Kosongkan</button></div>
      ${staged.map((f, i) => {
        const subs = new Set(f.entries.map((e) => e.folder)).size;
        const vids = f.entries.filter((e) => !/^audio\//.test(e.file.type) && /\.(mp4|m4v|mov|webm|mkv|3gp|3g2|avi|wmv|flv|ts|mts)$/i.test(e.file.name)).length;
        return `
        <div class="staged-item">
          <div class="staged-ic">${icon('folder')}</div>
          <div class="staged-text"><b>${esc(f.name)}</b><small>${f.entries.length} file${vids ? ` (${vids} video → MP3)` : ''}${subs > 1 ? ` · ${subs} folder` : ''}${f.skipped ? ` · ${f.skipped} file lain diabaikan` : ''}</small></div>
          <button class="icon-btn sm" data-act="unstage" data-i="${i}" aria-label="Hapus dari daftar">${icon('close')}</button>
        </div>`;
      }).join('')}
      <details class="staged-list">
        <summary>Lihat urutan lagu (${all.length})</summary>
        <ol>${all.slice(0, 300).map((e) => `<li><span>${esc(e.file.name)}</span><small>${esc(e.folder)}</small></li>`).join('')}${all.length > 300 ? `<li class="muted">… dan ${all.length - 300} lainnya</li>` : ''}</ol>
      </details>
      ${dupCount ? `<p class="staged-dup">${icon('shield')} ${dupCount} file sudah ada di pustaka atau terpilih dua kali — akan <b>dilewati otomatis</b> agar tidak dobel.</p>` : ''}
      <label class="check"><input type="checkbox" id="folderPl" ${makePl ? 'checked' : ''}><span>Buat <b>playlist untuk tiap folder</b> (nama playlist = nama folder)</span></label>
      <div class="btn-row">
        <button class="btn primary" data-act="import-staged" ${all.length ? '' : 'disabled'}>${icon('upload')} Tambahkan ${all.length} file</button>
        <button class="btn ghost" data-act="pick-folder">${icon('plus')} Folder lain</button>
      </div>
    </section>`;
  $('#folderPl').addEventListener('change', (e) => store.saveSettings({ folderPlaylists: e.target.checked }));
}

async function importStaged() {
  const all = staged.flatMap((f) => f.entries);
  if (!all.length) return;
  const makePl = store.settings.folderPlaylists !== false;
  staged.length = 0;
  renderStaged();
  const summary = await runImport(all, { quiet: true });
  let made = 0;
  if (makePl && summary.items) made = await createFolderPlaylists(summary.items);
  const n = summary.added.length;
  const parts = [];
  if (n) parts.push(`${n} lagu ditambahkan${summary.converted ? ` (${summary.converted} dari video)` : ''}`);
  if (summary.dup) parts.push(`${summary.dup} dilewati karena sudah ada`);
  if (made) parts.push(`${made} playlist folder`);
  if (summary.failed.length) parts.push(`${summary.failed.length} gagal`);
  const msg = parts.join(' · ') || 'Tidak ada lagu baru';
  if (summary.failed.length) toast(msg, { kind: 'warn', action: { label: 'Detail', fn: () => showFailures(summary.failed) } });
  else toast(msg, { action: { label: 'Lihat', fn: () => { store.saveSettings({ libraryTab: made ? 'playlists' : 'songs', librarySort: 'folder' }); A.go('#/library'); } } });
}

/** Satu playlist untuk tiap folder yang berisi lagu. Folder yang sudah punya playlist cukup ditambah. */
async function createFolderPlaylists(items) {
  const byFolder = new Map();
  for (const it of items) {
    if (!it.id || !it.folder) continue;
    if (!byFolder.has(it.folder)) byFolder.set(it.folder, []);
    const ids = byFolder.get(it.folder);
    if (!ids.includes(it.id)) ids.push(it.id);
  }
  const folders = [...byFolder.keys()];
  const last = (f) => f.split('/').pop();
  const nameOf = (f) => {
    const clash = folders.filter((g) => last(g) === last(f)).length > 1;
    const parts = f.split('/');
    return clash && parts.length > 1 ? `${parts[parts.length - 2]} / ${last(f)}` : last(f);
  };
  let made = 0;
  for (const f of folders) {
    const name = nameOf(f);
    const existing = store.findPlaylistByName(name);
    if (existing) await store.addToPlaylist(existing.id, byFolder.get(f));
    else { await store.createPlaylist(name, byFolder.get(f)); made++; }
  }
  return made;
}

// ---------- Cari & hapus lagu dobel ----------
async function findDuplicateGroups(onProgress) {
  const songs = store.all();
  const map = new Map();
  for (let i = 0; i < songs.length; i++) {
    const s = songs[i];
    let key = null;
    if (s.source === 'youtube') key = `yt:${s.ytId}`;
    else if (s.source === 'url') key = `url:${s.url}`;
    else {
      let h = s.audioHash;
      if (!h) {
        const blob = await store.audioBlob(s.id).catch(() => null);
        h = blob ? await fingerprint(blob) : null;
        if (h) {
          const patch = { audioHash: h };
          if (!s.convertedFrom && !s.srcHash) patch.srcHash = h; // file asli = file tersimpan
          await store.patchSilently(s.id, patch);
        }
      }
      if (h) key = `a:${h}`;
    }
    onProgress(i + 1, songs.length);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  const rank = (x) => (x.liked ? 1e12 : 0) + (x.playCount || 0) * 1e6 - (x.addedAt || 0) / 1e7;
  return [...map.values()].filter((g) => g.length > 1).map((g) => {
    const sorted = g.slice().sort((a, b) => rank(b) - rank(a));
    return { keep: sorted[0], remove: sorted.slice(1) };
  });
}

async function runDedupe(btn) {
  if (!store.songs.size) { toast('Pustaka masih kosong'); return; }
  const label = btn.textContent;
  btn.disabled = true;
  let groups;
  try {
    groups = await findDuplicateGroups((i, n) => { if (btn.isConnected) btn.textContent = `Memeriksa ${i}/${n}…`; });
  } finally {
    if (btn.isConnected) { btn.disabled = false; btn.textContent = label; }
  }
  if (!groups.length) { toast('Tidak ada lagu dobel. Pustaka kamu sudah rapi 👍'); return; }
  const total = groups.reduce((a, g) => a + g.remove.length, 0);
  openModal({
    title: `${total} lagu dobel ditemukan`,
    body: `<p class="modal-text">Lagu berikut tersimpan lebih dari sekali. Satu disimpan, salinannya dihapus. Status suka, jumlah putar, dan posisi di playlist tetap dipertahankan.</p>
      <div class="dup-list">${groups.map((g) => `
        <div class="dup-row">${coverHTMLsafe(g.keep)}<span><b>${esc(g.keep.title)}</b><small>${esc(g.keep.artist)}</small></span><em>${g.remove.length + 1}×</em></div>`).join('')}
      </div>`,
    actions: [
      { label: 'Batal', kind: 'ghost' },
      { label: `Hapus ${total} salinan`, kind: 'danger', onClick: async () => {
        const n = await store.mergeDuplicates(groups.map((g) => ({ keepId: g.keep.id, removeIds: g.remove.map((x) => x.id) })));
        toast(`${n} lagu dobel dihapus`);
      } },
    ],
    onOpen: (root) => hydrateCovers(root),
  });
}

async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* abaikan */ }
}

async function fillStorageInfo() {
  const note = $('#persistNote');
  const btn = $('#persistBtn');
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      if ($('#storageUsed')) {
        $('#storageUsed').textContent = `${fmtBytes(Math.max(usage, store.totalBytes()))} terpakai`;
        if (quota) {
          $('#storageQuota').textContent = `dari ± ${fmtBytes(quota)} yang tersedia untuk aplikasi ini`;
          $('#storageFill').style.width = `${Math.min(100, (usage / quota) * 100).toFixed(1)}%`;
        }
      }
    }
    if (navigator.storage && navigator.storage.persisted) {
      const p = await navigator.storage.persisted();
      if (note) note.innerHTML = p
        ? `${icon('shield')} Penyimpanan permanen aktif — browser tidak akan menghapus lagu otomatis.`
        : 'Browser bisa menghapus data saat memori hampir penuh. Pasang aplikasi atau aktifkan perlindungan di bawah agar lagu tetap aman.';
      if (btn) btn.hidden = p;
    } else if (note) note.textContent = '';
  } catch {
    if (note) note.textContent = '';
  }
}

// ---------- Drag & drop ----------
async function filesFromDrop(dt) {
  const entries = [...(dt.items || [])].map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
  const plain = [...(dt.files || [])];
  if (!entries.length || !entries.some((e) => e.isDirectory)) return plain;
  const out = [];
  const walk = async (entry) => {
    if (entry.isFile) {
      try {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        const folder = entry.fullPath.replace(/^\//, '').split('/').slice(0, -1).join('/');
        out.push({ file, folder });
      } catch { /* lewati */ }
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res) => reader.readEntries(res, () => res([])));
        for (const e of batch) await walk(e);
      } while (batch.length);
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

function setupDragDrop() {
  const overlay = $('#dropOverlay');
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.hidden = true;
  });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    const pid = route.name === 'playlist' ? route.params[0] : null;
    const items = await filesFromDrop(e.dataTransfer);
    const inFolder = items.filter((x) => !(x instanceof Blob) && x.folder);
    if (inFolder.length && !pid) {
      // Folder yang diseret masuk ke daftar folder (bisa beberapa sekaligus)
      const groups = new Map();
      inFolder.forEach((x) => { const root = x.folder.split('/')[0]; if (!groups.has(root)) groups.set(root, []); groups.get(root).push(x); });
      groups.forEach((entries, root) => stageFolder(root, entries));
      const loose = items.filter((x) => x instanceof Blob || !x.folder);
      if (loose.length) runImport(loose);
      return;
    }
    runImport(items, pid && store.playlists.has(pid) ? { playlistId: pid } : {});
  });
}

// ---------- Mode pilih ----------
function exitSelecting(rerender = true) {
  if (!V.viewState.selecting) return;
  V.viewState.selecting = false;
  V.viewState.selected.clear();
  if (rerender) renderView(true);
}

function selectedIds() { return [...V.viewState.selected].filter((id) => store.get(id)); }

function toggleRowSelection(rowEl) {
  const id = rowEl.dataset.id;
  if (V.viewState.selected.has(id)) V.viewState.selected.delete(id);
  else V.viewState.selected.add(id);
  rowEl.classList.toggle('sel', V.viewState.selected.has(id));
  const c = $('#selCount');
  if (c) c.textContent = V.viewState.selected.size;
}

// ---------- Aksi klik ----------
function listOf(el) {
  const key = el.dataset.list || el.closest('[data-list]')?.dataset.list;
  return key ? V.lists[key] : null;
}

function playContext(ids, context, shuffle) {
  if (!ids.length) return;
  if (V.sameContext(player.context, context) && player.current && shuffle === undefined) {
    player.toggle();
    return;
  }
  player.playList(ids, shuffle || (shuffle === undefined && player.shuffle) ? -1 : 0, context, shuffle !== undefined ? { shuffle } : {});
}

async function handleAct(act, el, e) {
  const id = el.dataset.id;
  switch (act) {
    // pemutar
    case 'toggle': player.toggle(); break;
    case 'next': player.next(); break;
    case 'prev': player.prev(); break;
    case 'shuffle': player.toggleShuffle(); toast(player.shuffle ? 'Acak aktif' : 'Acak mati'); break;
    case 'repeat': player.cycleRepeat(); toast({ off: 'Ulangi mati', all: 'Ulangi semua lagu', one: 'Ulangi lagu ini' }[player.repeat]); break;
    case 'mute': player.toggleMute(); break;
    case 'queue': PUI.toggleQueue(); break;
    case 'open-np': if (player.current) PUI.openNowPlaying(); break;
    case 'close-np': PUI.closeNowPlaying(); break;
    case 'yt-close': player.stopYouTube(); break;
    case 'np-menu': PUI.nowPlayingMenu(el); break;
    case 'sleep': PUI.sleepMenu(el); break;
    case 'like-current': if (player.current) A.toggleLike(player.current.id); break;

    // daftar lagu
    case 'like': A.toggleLike(id); break;
    case 'song-menu': {
      const l = listOf(el);
      A.songMenu(el, id, { playlistId: l?.playlistId });
      break;
    }
    case 'row': {
      if (V.viewState.selecting && el.closest('.tracklist.selecting')) { toggleRowSelection(el); break; }
      const l = listOf(el);
      if (!l) break;
      const i = +el.dataset.i;
      if (player.currentId === l.ids[i] && V.sameContext(player.context, l.context)) { player.toggle(); break; }
      player.playList(l.ids, i, l.context);
      break;
    }
    case 'play-from': {
      const l = listOf(el);
      if (l) player.playList(l.ids, +el.dataset.i, l.context);
      break;
    }
    case 'play-list': { const l = listOf(el); if (l) playContext(l.ids, l.context); break; }
    case 'shuffle-list': { const l = listOf(el); if (l) playContext(l.ids, l.context, true); break; }
    case 'play-playlist': {
      const pl = store.playlists.get(id);
      if (pl) playContext(store.playlistSongs(id).map((s) => s.id), { type: 'playlist', id, label: pl.name });
      break;
    }
    case 'play-liked': playContext(store.liked().map((s) => s.id), { type: 'liked', id: null, label: 'Lagu Disukai' }); break;

    // playlist
    case 'new-playlist': A.createPlaylist(); break;
    case 'playlist-menu': A.playlistMenu(el, id); break;
    case 'playlist-add': A.addSongsToPlaylistDialog(id); break;
    case 'import-to-playlist': {
      pickFiles({ playlistId: id });
      const modal = el.closest('.modal');
      if (modal) modal.querySelector('[data-close]').click();
      break;
    }

    // tambah lagu
    case 'pick-files': pickFiles(); break;
    case 'pick-folder': pickFolder(); break;
    case 'import-staged': importStaged(); break;
    case 'unstage': staged.splice(+el.dataset.i, 1); renderStaged(); break;
    case 'unstage-all': staged.length = 0; renderStaged(); break;
    case 'dedupe': runDedupe(el); break;

    // pustaka & pilih
    case 'lib-tab': exitSelecting(false); store.saveSettings({ libraryTab: el.dataset.tab }); renderView(false); break;
    case 'sel-start': V.viewState.selecting = true; V.viewState.selected.clear(); renderView(true); break;
    case 'sel-cancel': exitSelecting(); break;
    case 'sel-all': {
      const l = listOf(el);
      if (!l) break;
      const all = l.ids.every((x) => V.viewState.selected.has(x));
      V.viewState.selected.clear();
      if (!all) l.ids.forEach((x) => V.viewState.selected.add(x));
      renderView(true);
      break;
    }
    case 'sel-playlist': {
      const ids = selectedIds();
      if (!ids.length) { toast('Pilih lagu dulu'); break; }
      openMenu(el, A.playlistSubmenu(ids), { header: `<strong>Tambah ${ids.length} lagu ke playlist</strong>` });
      break;
    }
    case 'sel-delete': {
      const ids = selectedIds();
      if (!ids.length) { toast('Pilih lagu dulu'); break; }
      const l = listOf(el);
      if (l && l.playlistId) {
        A.multiMenu(el, ids, { playlistId: l.playlistId, done: () => exitSelecting() });
      } else if (await A.deleteSongs(ids)) exitSelecting();
      break;
    }
    case 'sel-more': {
      const ids = selectedIds();
      if (!ids.length) { toast('Pilih lagu dulu'); break; }
      const l = listOf(el);
      A.multiMenu(el, ids, { playlistId: l?.playlistId, done: () => exitSelecting() });
      break;
    }

    // lain-lain
    case 'search-clear': {
      const input = $('#searchInput');
      input.value = '';
      input.dispatchEvent(new Event('input'));
      input.focus();
      break;
    }
    case 'accent':
      store.saveSettings({ accent: el.dataset.accent });
      applyAccent();
      renderView(true);
      break;
    case 'install':
      if (deferredInstall) {
        deferredInstall.prompt();
        try { await deferredInstall.userChoice; } catch { /* abaikan */ }
        deferredInstall = null;
        updateInstallButtons();
      }
      break;
    case 'persist':
      try {
        const ok = navigator.storage && (await navigator.storage.persist());
        toast(ok ? 'Lagu dilindungi dari penghapusan otomatis' : 'Browser belum mengizinkan. Coba pasang aplikasi dulu, lalu ulangi.', { kind: ok ? '' : 'warn' });
      } catch { toast('Tidak didukung di browser ini', { kind: 'warn' }); }
      fillStorageInfo();
      break;
    case 'wipe': {
      const ok = await confirmDialog('Hapus semua data?', `Semua <b>${store.songs.size} lagu</b> dan <b>${store.playlists.size} playlist</b> akan dihapus permanen dari perangkat ini.`, { okLabel: 'Lanjut', danger: true });
      if (!ok) break;
      const ok2 = await confirmDialog('Yakin?', 'Tindakan ini tidak bisa dibatalkan.', { okLabel: 'Hapus semuanya', danger: true });
      if (!ok2) break;
      await store.deleteEverything();
      toast('Semua lagu dan playlist dihapus');
      break;
    }
    case 'back':
      if (history.length > 1) history.back(); else A.go('#/home');
      break;
    default: break;
  }
}

function setupEvents() {
  document.addEventListener('click', (e) => {
    if (PUI.handleQueueClick(e)) return;
    const actEl = e.target.closest('[data-act]');
    const link = e.target.closest('a[href^="#"]');
    if (link && (!actEl || actEl.contains(link))) {
      e.preventDefault();
      A.go(link.getAttribute('href'));
      return;
    }
    if (actEl) {
      if (actEl.disabled) return;
      if (actEl.closest('#layer') && !actEl.closest('.modal')) return; // menu ditangani sendiri
      handleAct(actEl.dataset.act, actEl, e);
      return;
    }
    const href = e.target.closest('[data-href]');
    if (href) A.go(href.dataset.href);
  });

  document.addEventListener('contextmenu', (e) => {
    const r = e.target.closest('.row[data-id]');
    if (!r || r.classList.contains('head')) return;
    e.preventDefault();
    if (r.classList.contains('q-row')) {
      A.songMenu({ x: e.clientX, y: e.clientY }, r.dataset.id, r.classList.contains('playing') ? { header: true } : { queueIndex: +r.dataset.q, header: true });
      return;
    }
    const l = listOf(r);
    A.songMenu({ x: e.clientX, y: e.clientY }, r.dataset.id, { playlistId: l?.playlistId, header: true });
  });

  // Enter pada elemen yang bisa difokus
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const el = e.target;
    if (el.matches && el.matches('[data-href], .row[data-act], .card[data-act], .tile')) { e.preventDefault(); el.click(); }
  });

  // Pintasan keyboard
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const tag = t.tagName;
    const isRange = tag === 'INPUT' && t.type === 'range';
    const typing = (tag === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(t.type)) || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
    if (typing || e.altKey) return;
    if ($('#layer').children.length) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.code === 'Space') { e.preventDefault(); player.toggle(); return; }
    if (e.key === 'Escape') {
      if (document.body.classList.contains('queue-open')) PUI.closeQueue();
      else if (document.body.classList.contains('np-open')) PUI.closeNowPlaying();
      else if (V.viewState.selecting) exitSelecting();
      return;
    }
    if (isRange && !mod) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); if (mod) player.next(); else player.seekBy(5); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); if (mod) player.prev(); else player.seekBy(-5); return; }
    if (mod && e.key === 'ArrowUp') { e.preventDefault(); player.setVolume(player.audio.volume + 0.1); return; }
    if (mod && e.key === 'ArrowDown') { e.preventDefault(); player.setVolume(player.audio.volume - 0.1); return; }
    if (mod) return;
    const k = e.key.toLowerCase();
    if (k === 'm') player.toggleMute();
    else if (k === 's') handleAct('shuffle', document.body, e);
    else if (k === 'r') handleAct('repeat', document.body, e);
    else if (k === 'l' && player.current) A.toggleLike(player.current.id);
    else if (k === '/') { e.preventDefault(); A.go('#/search'); }
  });

  window.addEventListener('hashchange', () => {
    route = parseRoute();
    exitSelecting(false);
    renderView(false);
    renderSidebar();
  });
}

// ---------- Tema ----------
function applyAccent() {
  const a = store.settings.accent;
  document.documentElement.dataset.accent = V.ACCENTS[a] ? a : 'violet';
}

// ---------- Pasang aplikasi (PWA) ----------
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function updateInstallButtons() {
  $$('[data-act="install"]').forEach((b) => { b.hidden = !deferredInstall; });
  $$('.installed-note').forEach((n) => { n.hidden = !isStandalone(); });
}

function setupPWA() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    updateInstallButtons();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    updateInstallButtons();
    toast('Aplikasi terpasang. Buka dari layar utama!');
  });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    let updateRequested = false;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Versi baru aplikasi tersedia', {
              timeout: 20000,
              action: { label: 'Perbarui', fn: () => { updateRequested = true; nw.postMessage('skip-waiting'); } },
            });
          }
        });
      });
    }).catch((err) => console.warn('Service worker gagal:', err));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updateRequested) location.reload();
    });
  }

  // File dibagikan dari aplikasi lain (Android: Bagikan → aplikasi ini)
  const params = new URLSearchParams(location.search);
  if (params.has('shared')) {
    history.replaceState(null, '', location.pathname + (location.hash || '#/add'));
    readShareInbox().then((items) => {
      const files = items.filter((x) => x instanceof Blob);
      if (files.length) runImport(files);
      else if (params.get('shared') === 'error') toast('File yang dibagikan tidak bisa dibaca', { kind: 'warn' });
    });
  }

  // Buka file audio dengan aplikasi ini (Chrome desktop)
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (lp) => {
      if (!lp.files || !lp.files.length) return;
      const files = await Promise.all(lp.files.map((h) => h.getFile()));
      runImport(files);
    });
  }
}

function readShareInbox() {
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open('lagu-inbox', 1); } catch { resolve([]); return; }
    req.onupgradeneeded = () => req.result.createObjectStore('files', { autoIncrement: true });
    req.onerror = () => resolve([]);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('files', 'readwrite');
      const st = tx.objectStore('files');
      const all = st.getAll();
      all.onsuccess = () => { st.clear(); };
      tx.oncomplete = () => { db.close(); resolve(all.result || []); };
      tx.onerror = () => { db.close(); resolve([]); };
    };
  });
}

// ---------- Mulai ----------
async function boot() {
  hydrateIcons(document);
  applyAccent();
  try {
    await store.init();
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="empty"><div class="empty-ic">${icon('alert')}</div><h3>Penyimpanan tidak tersedia</h3><p>${esc(err.message || 'Browser menolak penyimpanan lokal.')}<br>Coba buka di Chrome/Edge/Safari versi terbaru dan jangan gunakan mode penyamaran.</p></div>`;
    return;
  }
  player = new Player($('#audio'), new YTEngine('ytMount'));
  A.ctx.player = player;
  PUI.initPlayerUI(player);
  player.restore();

  store.subscribe((type, detail) => {
    if (type === 'songs-deleted' && detail) detail.forEach((id) => V.viewState.selected.delete(id));
    if (['songs', 'songs-deleted', 'playlists'].includes(type)) scheduleRender();
  });

  route = parseRoute();
  setupEvents();
  setupDragDrop();
  setupPWA();
  renderSidebar();
  renderView(false);
  document.body.classList.add('ready');
}

boot();
