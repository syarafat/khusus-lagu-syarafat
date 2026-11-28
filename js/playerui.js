// Tampilan pemutar: bar bawah, layar penuh "Sedang diputar", panel antrean.
import { store } from './store.js';
import { icon, setIcon } from './icons.js';
import { $, $$, esc, fmtTime, coverHTML, hydrateCovers, pushOverlay, popOverlay, isMobile, openMenu, toast } from './ui.js';
import { songMenu, artistHash } from './actions.js';
import { lists, sameContext } from './views.js';

let player;
let npEntry = null;
let queueEntry = null;
let raf = 0;
let dragging = { p: false, np: false };

export function initPlayerUI(p) {
  player = p;
  const seekP = $('#pSeek');
  const seekNP = $('#npSeek');
  const vol = $('#pVol');

  const bindSeek = (el, key) => {
    el.addEventListener('input', () => {
      dragging[key] = true;
      const t = (el.value / 1000) * player.duration;
      setRangeFill(el);
      if (key === 'p') $('#pCur').textContent = fmtTime(t);
      else $('#npCur').textContent = fmtTime(t);
    });
    el.addEventListener('change', () => {
      player.seek((el.value / 1000) * player.duration);
      dragging[key] = false;
    });
    el.addEventListener('pointerup', () => setTimeout(() => { dragging[key] = false; }, 50));
  };
  bindSeek(seekP, 'p');
  bindSeek(seekNP, 'np');

  vol.addEventListener('input', () => { player.setVolume(vol.value / 100); setRangeFill(vol); });

  player.addEventListener('track', renderTrack);
  player.addEventListener('state', renderState);
  player.addEventListener('modes', renderModes);
  player.addEventListener('volume', renderVolume);
  player.addEventListener('queue', () => { renderQueue(); renderContext(); });
  player.addEventListener('sleep', renderSleep);
  player.addEventListener('error', (e) => toast(e.detail, { kind: 'warn' }));
  player.addEventListener('time', () => { if (!player.isPlaying) renderTime(); });
  player.addEventListener('yt-loading', layoutDock);
  player.audio.addEventListener('emptied', renderTime);
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(layoutDock, 120); });

  // Geser ke bawah untuk menutup layar "Sedang diputar" (HP)
  const np = $('#np');
  let startY = null;
  let dy = 0;
  np.addEventListener('touchstart', (e) => {
    if (e.target.closest('input, button')) return;
    startY = e.touches[0].clientY;
    dy = 0;
  }, { passive: true });
  np.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    np.querySelector('.np-inner').style.transform = `translateY(${dy * 0.6}px)`;
  }, { passive: true });
  np.addEventListener('touchend', () => {
    if (startY === null) return;
    np.querySelector('.np-inner').style.transform = '';
    if (dy > 110) closeNowPlaying();
    startY = null;
  });

  renderTrack();
  renderState();
  renderModes();
  renderVolume();
  renderSleep();
}

export function setRangeFill(el) {
  const min = +el.min || 0;
  const max = +el.max || 100;
  el.style.setProperty('--p', `${((el.value - min) / (max - min)) * 100}%`);
}

function renderTrack() {
  const s = player.current;
  const bar = $('#player');
  bar.dataset.empty = s ? 'false' : 'true';
  document.body.classList.toggle('has-track', !!s);
  $('#pTitle').textContent = s ? s.title : 'Belum ada lagu';
  $('#pArtist').textContent = s ? s.artist : 'Pilih lagu untuk diputar';
  $('#pCover').innerHTML = coverHTML(s);
  $('#npTitle').textContent = s ? s.title : '—';
  $('#npArtist').innerHTML = s ? `<a href="${artistHash(s.artist)}">${esc(s.artist)}</a>` : '—';
  $('#npArt').innerHTML = coverHTML(s);
  $('#np').style.setProperty('--c', s ? s.color : 'var(--panel-2)');
  bar.style.setProperty('--c', s ? s.color : '#333');
  hydrateCovers($('#player'));
  hydrateCovers($('#np'));
  const liked = !!(s && s.liked);
  ['#pLike', '#npLike'].forEach((sel) => {
    const b = $(sel);
    b.classList.toggle('on', liked);
    b.disabled = !s || !store.get(s.id); // lagu dari Dengar Bareng bukan milik pustaka
    setIcon(b, liked ? 'heartFill' : 'heart');
    b.setAttribute('aria-label', liked ? 'Hapus dari Lagu Disukai' : 'Simpan ke Lagu Disukai');
  });
  document.title = s && player.isPlaying ? `${s.title} · ${s.artist}` : 'Lagu Syarafat';
  renderContext();
  layoutDock();
  markPlaying();
  renderTime();
  renderQueue();
}

function renderContext() {
  const c = player.context;
  $('#npContext').textContent = c ? c.label : 'Pustaka';
}

function renderState() {
  const playing = player.isPlaying;
  document.body.classList.toggle('is-playing', playing);
  ['#pPlay', '#pPlayMini', '#npPlay'].forEach((sel) => {
    const b = $(sel);
    setIcon(b, playing ? 'pause' : 'play');
    b.setAttribute('aria-label', playing ? 'Jeda' : 'Putar');
    b.title = playing ? 'Jeda' : 'Putar';
  });
  const s = player.current;
  document.title = s && playing ? `${s.title} · ${s.artist}` : 'Lagu Syarafat';
  updateContextButtons();
  if (playing) startLoop(); else stopLoop();
  renderTime();
  layoutDock();
}

// ---------- Jendela video YouTube ----------
let dockTimer = 0;
export function layoutDock() {
  const dock = $('#ytDock');
  const show = !!(player && player.isYouTube && player.yt.wanted);
  document.body.classList.toggle('yt-on', show);
  dock.hidden = !show;
  if (!show) return;
  const inNP = !!npEntry;
  dock.classList.toggle('in-np', inNP);
  if (!inNP) {
    dock.classList.remove('fading');
    dock.style.left = dock.style.top = dock.style.width = dock.style.height = '';
    return;
  }
  const r = $('#npArt').getBoundingClientRect();
  if (!r.width) return;
  // Video 16:9 di area sampul, minimal 356 px lebar (tinggi ≥ 200 px sesuai aturan YouTube)
  const w = Math.min(window.innerWidth, Math.max(r.width, 356));
  const h = (w * 9) / 16;
  dock.style.left = `${Math.round(r.left + r.width / 2 - w / 2)}px`;
  dock.style.top = `${Math.round(r.top + r.height / 2 - h / 2)}px`;
  dock.style.width = `${Math.round(w)}px`;
  dock.style.height = `${Math.round(h)}px`;
}

function renderModes() {
  ['#pShuffle', '#npShuffle', '#pShuffleMini'].forEach((sel) => {
    const b = $(sel);
    b.classList.toggle('on', player.shuffle);
    b.title = player.shuffle ? 'Acak: aktif' : 'Acak: mati';
  });
  ['#pRepeat', '#npRepeat'].forEach((sel) => {
    const b = $(sel);
    b.classList.toggle('on', player.repeat !== 'off');
    setIcon(b, player.repeat === 'one' ? 'repeatOne' : 'repeat');
    b.title = { off: 'Ulangi: mati', all: 'Ulangi semua', one: 'Ulangi satu lagu' }[player.repeat];
  });
}

function renderVolume() {
  const a = player.audio;
  const vol = $('#pVol');
  vol.value = Math.round((a.muted ? 0 : a.volume) * 100);
  setRangeFill(vol);
  const v = a.muted ? 0 : a.volume;
  setIcon($('#pMute'), v === 0 ? 'volumeMute' : v < 0.5 ? 'volumeLow' : 'volume');
}

function renderSleep() {
  const r = player.sleepRemaining();
  const b = $('#npSleep');
  b.classList.toggle('on', r !== null);
  $('#npSleepLabel').textContent = r === null ? '' : r === 'track' ? 'Akhir lagu' : fmtTime(r / 1000);
}

function renderTime() {
  const d = player.duration;
  const t = player.time;
  const pct = d ? Math.min(1, t / d) : 0;
  if (!dragging.p) {
    const el = $('#pSeek');
    el.value = Math.round(pct * 1000);
    setRangeFill(el);
    $('#pCur').textContent = fmtTime(t);
  }
  $('#pDur').textContent = fmtTime(d);
  $('#miniFill').style.transform = `scaleX(${pct})`;
  if (npEntry && !dragging.np) {
    const el = $('#npSeek');
    el.value = Math.round(pct * 1000);
    setRangeFill(el);
    $('#npCur').textContent = fmtTime(t);
    $('#npDur').textContent = fmtTime(d);
  }
}

function startLoop() {
  if (raf) return;
  let last = 0;
  const tick = (ts) => {
    raf = requestAnimationFrame(tick);
    if (document.hidden || ts - last < 250) return;
    last = ts;
    renderTime();
    if (player.sleep && player.sleep.mode === 'time' && npEntry) renderSleep();
  };
  raf = requestAnimationFrame(tick);
}
function stopLoop() { cancelAnimationFrame(raf); raf = 0; }

export function markPlaying() {
  const id = player.currentId;
  $$('.row[data-id]').forEach((r) => r.classList.toggle('playing', r.dataset.id === id));
  updateContextButtons();
}

export function updateContextButtons() {
  $$('[data-ctx-key]').forEach((b) => {
    const l = lists[b.dataset.ctxKey];
    const active = l && sameContext(player.context, l.context) && player.isPlaying;
    setIcon(b, active ? 'pause' : 'play');
  });
}

// ---------- Layar "Sedang diputar" ----------
export function openNowPlaying() {
  if (npEntry || !player.current) return;
  const np = $('#np');
  np.hidden = false;
  requestAnimationFrame(() => np.classList.add('in'));
  document.body.classList.add('np-open');
  npEntry = pushOverlay(() => {
    np.classList.remove('in');
    document.body.classList.remove('np-open');
    npEntry = null;
    clearTimeout(dockTimer);
    layoutDock();
    setTimeout(() => { if (!npEntry) np.hidden = true; }, 260);
  });
  // Pindahkan video ke area sampul setelah animasi layar selesai
  $('#ytDock').classList.add('fading');
  clearTimeout(dockTimer);
  dockTimer = setTimeout(() => { layoutDock(); $('#ytDock').classList.remove('fading'); }, 330);
  renderTime();
  renderSleep();
}

export function closeNowPlaying() {
  if (npEntry) popOverlay(npEntry);
}

export function nowPlayingMenu(anchor) {
  const s = player.current;
  if (!s) return;
  songMenu(anchor, s.id, { header: true });
}

export function sleepMenu(anchor) {
  const cur = player.sleepRemaining();
  const opt = (label, v) => ({ icon: 'timer', label, onClick: () => { player.setSleep(v); toast(v === 'track' ? 'Musik berhenti di akhir lagu ini' : `Musik berhenti dalam ${label}`); } });
  const items = [opt('5 menit', 5), opt('15 menit', 15), opt('30 menit', 30), opt('45 menit', 45), opt('1 jam', 60), opt('Akhir lagu ini', 'track')];
  if (cur !== null) items.unshift({ icon: 'close', label: 'Matikan timer tidur', onClick: () => { player.clearSleep(); toast('Timer tidur dimatikan'); } }, '-');
  openMenu(anchor, items, { header: '<strong>Timer tidur</strong><small>Musik berhenti otomatis</small>' });
}

// ---------- Antrean ----------
export function toggleQueue() {
  const panel = $('#queuePanel');
  const mobile = isMobile() || document.body.classList.contains('np-open');
  if (!panel.hidden) { closeQueue(); return; }
  panel.hidden = false;
  panel.classList.toggle('as-sheet', mobile);
  document.body.classList.add('queue-open');
  document.body.classList.toggle('queue-docked', !mobile);
  $('#pQueueBtn').classList.add('on');
  renderQueue();
  if (mobile) {
    requestAnimationFrame(() => panel.classList.add('in'));
    queueEntry = pushOverlay(() => hideQueue());
  }
}

function hideQueue() {
  const panel = $('#queuePanel');
  panel.classList.remove('in');
  document.body.classList.remove('queue-open', 'queue-docked');
  $('#pQueueBtn').classList.remove('on');
  queueEntry = null;
  if (panel.classList.contains('as-sheet')) setTimeout(() => { if (!queueEntry) panel.hidden = true; }, 220);
  else panel.hidden = true;
}

export function closeQueue() {
  if (queueEntry) popOverlay(queueEntry);
  else hideQueue();
}

function queueRow(s, i, isCurrent) {
  return `
    <div class="row q-row${isCurrent ? ' playing' : ''}" data-q="${i}" data-id="${esc(s.id)}">
      <div class="c-main">${coverHTML(s, 'sm')}<div class="c-text"><div class="t">${esc(s.title)}</div><div class="a">${esc(s.artist)}</div></div></div>
      ${isCurrent ? '<span class="eq on"><i></i><i></i><i></i></span>' : `
        <button class="icon-btn sm" data-act="q-up" data-q="${i}" aria-label="Naikkan" title="Naikkan">${icon('chevronDown', 'flip')}</button>
        <button class="icon-btn sm" data-act="q-remove" data-q="${i}" aria-label="Hapus dari antrean" title="Hapus dari antrean">${icon('close')}</button>`}
    </div>`;
}

export function renderQueue() {
  const panel = $('#queuePanel');
  if (panel.hidden) return;
  const cur = player.current;
  const upcoming = player.queue.slice(player.index + 1).map((id, k) => ({ s: store.get(id), i: player.index + 1 + k })).filter((x) => x.s);
  panel.innerHTML = `
    <div class="qp-head">
      <h2>Antrean</h2>
      <button class="icon-btn" data-act="queue-close" aria-label="Tutup">${icon('close')}</button>
    </div>
    <div class="qp-body">
      ${cur ? `<h3>Sedang diputar</h3>${queueRow(cur, player.index, true)}` : '<p class="muted pad">Belum ada lagu yang diputar.</p>'}
      ${upcoming.length ? `
        <div class="qp-sub"><h3>Berikutnya${player.context ? ` dari <span>${esc(player.context.label)}</span>` : ''}</h3><button class="link-btn" data-act="queue-clear">Kosongkan</button></div>
        ${upcoming.slice(0, 200).map((x) => queueRow(x.s, x.i, false)).join('')}
        ${upcoming.length > 200 ? `<p class="muted pad">+${upcoming.length - 200} lagu lagi</p>` : ''}` : cur ? `<p class="muted pad">Tidak ada lagu berikutnya${player.repeat === 'all' ? ' (akan mengulang dari awal)' : ''}.</p>` : ''}
    </div>`;
  hydrateCovers(panel);
}

export function handleQueueClick(e) {
  const panel = $('#queuePanel');
  if (!panel.contains(e.target)) return false;
  const btn = e.target.closest('[data-act]');
  if (btn) {
    const q = +btn.dataset.q;
    if (btn.dataset.act === 'q-remove') { player.removeAt(q); return true; }
    if (btn.dataset.act === 'q-up') { player.moveInQueue(q, Math.max(player.index + 1, q - 1)); return true; }
    if (btn.dataset.act === 'queue-close') { closeQueue(); return true; }
    if (btn.dataset.act === 'queue-clear') { player.clearUpcoming(); toast('Antrean dikosongkan'); return true; }
  }
  const row = e.target.closest('.q-row');
  if (row && !row.classList.contains('playing')) { player.jumpTo(+row.dataset.q); return true; }
  return !!btn || !!row;
}
