// Komponen UI umum: toast, modal, menu, sampul, format waktu.
import { icon, hydrateIcons } from './icons.js';
import { store } from './store.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

// ---------- Format ----------
export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtTotal(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h) return `${h} jam ${m} mnt`;
  if (m) return `${m} mnt`;
  return `${sec} dtk`;
}

export function fmtBytes(n) {
  if (!n) return '0 MB';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i < 2 ? 0 : 1).replace('.', ',')} ${u[i]}`;
}

const dateFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
export function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  const days = Math.floor((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000);
  if (days <= 0) return 'Hari ini';
  if (days === 1) return 'Kemarin';
  if (days < 7) return `${days} hari lalu`;
  return dateFmt.format(d);
}

export function songCount(n) { return `${n} lagu`; }

// ---------- Toast ----------
export function toast(msg, opts = {}) {
  const root = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (opts.kind ? ' ' + opts.kind : '');
  el.innerHTML = `<span>${esc(msg)}</span>${opts.action ? `<button class="toast-btn">${esc(opts.action.label)}</button>` : ''}`;
  root.appendChild(el);
  const remove = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  };
  if (opts.action) {
    el.querySelector('button').addEventListener('click', () => { opts.action.fn(); remove(); });
  }
  setTimeout(remove, opts.timeout || (opts.action ? 6000 : 3200));
  while (root.children.length > 3) root.firstElementChild.remove();
  return remove;
}

// ---------- Tumpukan overlay (tombol Kembali di Android menutup overlay) ----------
const stack = [];
let popResolvers = [];

export function pushOverlay(close) {
  const entry = { close, pushed: false };
  stack.push(entry);
  try { history.pushState({ overlay: stack.length }, ''); entry.pushed = true; } catch { /* abaikan */ }
  return entry;
}

/** Tutup overlay teratas lewat history.back() agar riwayat tetap rapi. */
export function popOverlay(entry) {
  return new Promise((resolve) => {
    const top = stack[stack.length - 1];
    if (top && !top.pushed && (!entry || entry === top)) {
      stack.pop();
      top.close();
      resolve();
      return;
    }
    if (!stack.length || (entry && top !== entry)) {
      // bukan yang teratas: tutup langsung tanpa menyentuh history
      if (entry) {
        const i = stack.indexOf(entry);
        if (i >= 0) { stack.splice(i, 1); entry.close(); }
      }
      resolve();
      return;
    }
    popResolvers.push(resolve);
    history.back();
  });
}

export async function closeAllOverlays() {
  while (stack.length) await popOverlay();
}

window.addEventListener('popstate', () => {
  if (stack.length) {
    const entry = stack.pop();
    try { entry.close(); } catch (e) { console.error(e); }
  }
  const rs = popResolvers;
  popResolvers = [];
  rs.forEach((r) => r());
});

// ---------- Modal ----------
export function openModal({ title, body = '', actions = [], onOpen, wide = false, className = '' }) {
  const layer = $('#layer');
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''} ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="Tutup">${icon('close')}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${actions.length ? `<div class="modal-actions">${actions.map((a, i) => `<button class="btn ${a.kind || 'ghost'}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
    </div>`;
  hydrateIcons(scrim);
  layer.appendChild(scrim);
  requestAnimationFrame(() => scrim.classList.add('in'));
  const modal = scrim.querySelector('.modal');
  let closed = false;
  const destroy = () => {
    if (closed) return;
    closed = true;
    scrim.classList.remove('in');
    setTimeout(() => scrim.remove(), 200);
    document.removeEventListener('keydown', onKey, true);
  };
  const entry = pushOverlay(destroy);
  const close = () => { if (!closed) popOverlay(entry); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim || e.target.closest('[data-close]')) close();
  });
  modal.querySelectorAll('.modal-actions button').forEach((b) => {
    b.addEventListener('click', async () => {
      const a = actions[+b.dataset.i];
      if (a.onClick) {
        const r = await a.onClick(modal);
        if (r === false) return;
      }
      close();
    });
  });
  const api = { root: modal, close };
  if (onOpen) onOpen(modal, api);
  const first = modal.querySelector('input, textarea, select');
  if (first && !isMobile()) setTimeout(() => first.focus(), 50);
  return api;
}

export function confirmDialog(title, message, { okLabel = 'Ya', danger = false, cancelLabel = 'Batal' } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const m = openModal({
      title,
      body: `<p class="modal-text">${message}</p>`,
      actions: [
        { label: cancelLabel, kind: 'ghost' },
        { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => { result = true; } },
      ],
    });
    const obs = new MutationObserver(() => {
      if (!m.root.isConnected) { obs.disconnect(); resolve(result); }
    });
    obs.observe($('#layer'), { childList: true });
  });
}

export function promptDialog(title, { value = '', placeholder = '', okLabel = 'Simpan', label = '' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const m = openModal({
      title,
      body: `<label class="field">${label ? `<span>${esc(label)}</span>` : ''}<input type="text" class="input" maxlength="120" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`,
      actions: [
        { label: 'Batal', kind: 'ghost' },
        { label: okLabel, kind: 'primary', onClick: (root) => { result = root.querySelector('input').value.trim(); if (!result) return false; return true; } },
      ],
      onOpen: (root, api) => {
        const input = root.querySelector('input');
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && input.value.trim()) { result = input.value.trim(); api.close(); }
        });
        if (isMobile()) setTimeout(() => input.focus(), 250);
      },
    });
    const obs = new MutationObserver(() => {
      if (!m.root.isConnected) { obs.disconnect(); resolve(result); }
    });
    obs.observe($('#layer'), { childList: true });
  });
}

// ---------- Menu (popover di desktop, lembar bawah di HP) ----------
let activeMenu = null;

export function closeMenu() {
  if (activeMenu) activeMenu.close();
}

/**
 * items: [{ icon, label, onClick, danger, sub: items, hint }] atau '-' untuk pemisah
 * pos: { x, y } atau elemen anchor
 */
export function openMenu(anchor, items, { header = '' } = {}) {
  closeMenu();
  const sheet = isMobile();
  const layer = $('#layer');
  const wrap = document.createElement('div');
  wrap.className = sheet ? 'scrim sheet-scrim' : 'menu-catcher';
  const menu = document.createElement('div');
  menu.className = sheet ? 'sheet menu' : 'popover menu';
  menu.setAttribute('role', 'menu');
  wrap.appendChild(menu);
  layer.appendChild(wrap);

  let closed = false;
  const destroy = () => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('in');
    setTimeout(() => wrap.remove(), 180);
    document.removeEventListener('keydown', onKey, true);
    if (activeMenu && activeMenu.wrap === wrap) activeMenu = null;
  };
  const entry = pushOverlay(destroy);
  const close = () => popOverlay(entry);
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  activeMenu = { wrap, close };

  const render = (list, title, back) => {
    menu.innerHTML = `
      ${sheet ? '<div class="sheet-grip"></div>' : ''}
      ${title ? `<div class="menu-header">${title}</div>` : ''}
      ${back ? `<button class="menu-item" data-back>${icon('back')}<span>Kembali</span></button><div class="menu-sep"></div>` : ''}
      ${list.map((it, i) => it === '-' ? '<div class="menu-sep"></div>' : `
        <button class="menu-item ${it.danger ? 'danger' : ''}" data-i="${i}" role="menuitem" ${it.disabled ? 'disabled' : ''}>
          ${icon(it.icon || 'note')}<span>${esc(it.label)}</span>${it.sub ? icon('chevronRight', 'menu-chev') : ''}${it.hint ? `<small>${esc(it.hint)}</small>` : ''}
        </button>`).join('')}`;
    menu.querySelectorAll('[data-i]').forEach((b) => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const it = list[+b.dataset.i];
        if (it.sub) {
          const sub = typeof it.sub === 'function' ? it.sub() : it.sub;
          render(sub, `<strong>${esc(it.label)}</strong>`, () => render(list, title, back));
          if (!sheet) position();
          return;
        }
        await close();
        if (it.onClick) it.onClick();
      });
    });
    const bb = menu.querySelector('[data-back]');
    if (bb) bb.addEventListener('click', (e) => { e.stopPropagation(); back(); if (!sheet) position(); });
  };

  const position = () => {
    if (sheet) return;
    const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let x = anchor instanceof Element ? r.right - mw : r.left;
    let y = r.bottom + 6;
    if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
    if (x < 8) x = 8;
    if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 6);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  };

  render(items, header, null);
  position();
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.addEventListener('contextmenu', (e) => { e.preventDefault(); if (e.target === wrap) close(); });
  requestAnimationFrame(() => wrap.classList.add('in'));
  return { close };
}

// ---------- Sampul ----------
function coverImg(id) {
  const ready = store.coverUrlSync(id);
  return ready
    ? `<img alt="" class="ok" src="${ready}" data-cover="${esc(id)}" data-loading="1">`
    : `<img alt="" data-cover="${esc(id)}" decoding="async">`;
}

export function coverHTML(song, cls = '') {
  if (!song) return `<div class="cv ${cls}">${icon('note')}</div>`;
  return `<div class="cv ${cls}" style="--c:${esc(song.color || '#333')}">${icon('note')}${song.hasCover ? coverImg(song.id) : ''}</div>`;
}

export function likedCoverHTML(cls = '') {
  return `<div class="cv liked-cv ${cls}">${icon('heartFill')}</div>`;
}

export function playlistCoverHTML(pl, songs, cls = '') {
  const covers = songs.filter((s) => s.hasCover);
  const uniq = [];
  const seen = new Set();
  for (const s of covers) {
    const k = (s.album || s.id) + '|' + s.artist;
    if (!seen.has(k)) { seen.add(k); uniq.push(s); }
    if (uniq.length === 4) break;
  }
  if (uniq.length === 4) {
    return `<div class="cv mosaic ${cls}">${uniq.map((s) => coverImg(s.id)).join('')}</div>`;
  }
  if (uniq.length) return coverHTML(uniq[0], cls);
  let h = 0;
  for (const ch of pl.name || 'x') h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `<div class="cv ${cls}" style="--c:hsl(${Math.abs(h) % 360} 40% 30%)">${icon('note')}</div>`;
}

let io = null;
function loadCover(img) {
  if (img.dataset.loading) return;
  img.dataset.loading = '1';
  store.coverUrl(img.dataset.cover).then((url) => {
    if (!url) return;
    img.onload = () => img.classList.add('ok');
    img.src = url;
    if (img.complete) img.classList.add('ok');
  });
}

export function hydrateCovers(root = document) {
  const imgs = root.querySelectorAll('img[data-cover]:not([data-loading])');
  if (!imgs.length) return;
  if (!('IntersectionObserver' in window)) { imgs.forEach(loadCover); return; }
  if (!io) {
    io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { io.unobserve(e.target); loadCover(e.target); }
      });
    }, { rootMargin: '300px' });
  }
  imgs.forEach((img) => io.observe(img));
}
