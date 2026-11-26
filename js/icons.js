// Ikon SVG sederhana (digambar sendiri). Default: garis (stroke).
// Elemen dengan class "f" diisi warna penuh.
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  library: '<path d="M5 4v16M10 4v16M14.5 4.5l5 15"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  plusCircle: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  play: '<path class="f" d="M8 5.6v12.8c0 .8.9 1.3 1.6.9l10.2-6.4c.6-.4.6-1.3 0-1.7L9.6 4.8C8.9 4.3 8 4.8 8 5.6z"/>',
  pause: '<rect class="f" x="6" y="4.5" width="4" height="15" rx="1.2"/><rect class="f" x="14" y="4.5" width="4" height="15" rx="1.2"/>',
  next: '<path class="f" d="M5.5 6.2v11.6c0 .8.9 1.2 1.5.8l8.6-5.8c.6-.4.6-1.2 0-1.6L7 5.4c-.6-.4-1.5 0-1.5.8z"/><rect class="f" x="16.3" y="5" width="2.4" height="14" rx="1.1"/>',
  prev: '<path class="f" d="M18.5 6.2v11.6c0 .8-.9 1.2-1.5.8l-8.6-5.8c-.6-.4-.6-1.2 0-1.6L17 5.4c.6-.4 1.5 0 1.5.8z"/><rect class="f" x="5.3" y="5" width="2.4" height="14" rx="1.1"/>',
  shuffle: '<path d="M16 4h4v4M4 19 20 4M20 16v4h-4M14.5 14.5 20 20M4 5l5 5"/>',
  repeat: '<path d="m17 2 3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="m7 22-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  repeatOne: '<path d="m17 2 3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="m7 22-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/><path d="M11 10.5 12.5 9.5v5" stroke-width="1.8"/>',
  heart: '<path d="M12 20s-7.2-4.4-9-8.9C1.8 7.9 3.7 4.5 7.2 4.5c2 0 3.3 1.1 4.8 2.9 1.5-1.8 2.8-2.9 4.8-2.9 3.5 0 5.4 3.4 4.2 6.6C19.2 15.6 12 20 12 20z"/>',
  heartFill: '<path class="f" d="M12 20s-7.2-4.4-9-8.9C1.8 7.9 3.7 4.5 7.2 4.5c2 0 3.3 1.1 4.8 2.9 1.5-1.8 2.8-2.9 4.8-2.9 3.5 0 5.4 3.4 4.2 6.6C19.2 15.6 12 20 12 20z"/>',
  more: '<circle class="f" cx="5" cy="12" r="1.8"/><circle class="f" cx="12" cy="12" r="1.8"/><circle class="f" cx="19" cy="12" r="1.8"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16z"/><path d="m14 6 4 4"/>',
  queue: '<path d="M3 6h14M3 12h14M3 18h8"/><path class="f" d="M15 15.2v5.6c0 .5.6.8 1 .5l4.3-2.8c.4-.3.4-.8 0-1.1L16 14.7c-.4-.3-1 0-1 .5z"/>',
  queueAdd: '<path d="M3 6h14M3 12h14M3 18h8M18 15v6M15 18h6"/>',
  playNext: '<path d="M3 6h9M3 12h9M3 18h9"/><path class="f" d="M15 8.2v7.6c0 .6.7 1 1.2.6l5.4-3.8c.4-.3.4-1 0-1.3l-5.4-3.8c-.5-.3-1.2 0-1.2.7z"/>',
  listPlus: '<path d="M3 6h14M3 12h10M3 18h7M17 13v8M13 17h8"/>',
  volume: '<path class="f" d="M4 9.2v5.6c0 .4.3.7.7.7H8l4.6 3.8c.5.4 1.4.1 1.4-.6V5.3c0-.7-.9-1-1.4-.6L8 8.5H4.7c-.4 0-.7.3-.7.7z"/><path d="M17 9a4.2 4.2 0 0 1 0 6M19.6 6.4a8 8 0 0 1 0 11.2"/>',
  volumeLow: '<path class="f" d="M4 9.2v5.6c0 .4.3.7.7.7H8l4.6 3.8c.5.4 1.4.1 1.4-.6V5.3c0-.7-.9-1-1.4-.6L8 8.5H4.7c-.4 0-.7.3-.7.7z"/><path d="M17 9a4.2 4.2 0 0 1 0 6"/>',
  volumeMute: '<path class="f" d="M4 9.2v5.6c0 .4.3.7.7.7H8l4.6 3.8c.5.4 1.4.1 1.4-.6V5.3c0-.7-.9-1-1.4-.6L8 8.5H4.7c-.4 0-.7.3-.7.7z"/><path d="m17 9.5 5 5M22 9.5l-5 5"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  upload: '<path d="M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  link: '<path d="M10 13.5a4.5 4.5 0 0 0 6.8.5l2.8-2.8a4.5 4.5 0 0 0-6.4-6.4l-1.6 1.6"/><path d="M14 10.5a4.5 4.5 0 0 0-6.8-.5l-2.8 2.8a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6"/>',
  timer: '<path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.8 6.8 0 0 0 10 10z"/>',
  check: '<path d="M5 12.5 10 17l9-10"/>',
  note: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  select: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M4 20h16"/>',
  install: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 7v7M9 11l3 3 3-3"/>',
  sort: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 7.9 7.5 9.5 4.3-1.6 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2a1.6 1.6 0 0 1 1.2-2.7H16a5 5 0 0 0 5-5C21 6.3 17 3 12 3z"/><circle class="f" cx="7.5" cy="11" r="1.3"/><circle class="f" cx="10.5" cy="7" r="1.3"/><circle class="f" cx="15.2" cy="7.4" r="1.3"/>',
  storage: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.4v.1"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0"/>',
};

export function icon(name, cls = '') {
  const body = P[name] || P.note;
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Ganti <i data-icon="x"> dengan SVG. */
export function hydrateIcons(root = document) {
  root.querySelectorAll('i[data-icon]').forEach((el) => {
    el.outerHTML = icon(el.dataset.icon, el.className);
  });
}

/** Set ikon di dalam tombol (mengganti SVG pertama). */
export function setIcon(btn, name) {
  if (!btn) return;
  if (btn.dataset.iconName === name) return;
  btn.dataset.iconName = name;
  const svg = btn.querySelector('svg.ic');
  const html = icon(name);
  if (svg) svg.outerHTML = html;
  else btn.insertAdjacentHTML('afterbegin', html);
}
