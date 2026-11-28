// Tampilan Dengar Bareng: jendela sesi + penanda kecil di layar.
import { store } from './store.js';
import { icon } from './icons.js';
import { $, esc, toast, openModal, isMobile } from './ui.js';
import { together } from './together.js';

let modal = null;
let pendingJoinCode = '';

const fmtCode = (c) => (c ? `${c.slice(0, 3)} ${c.slice(3)}` : '');
const inviteUrl = (code) => new URL(`#/join/${code}`, location.href.split('#')[0]).href;

export function initTogetherUI(player) {
  together.init(player);
  together.addEventListener('change', () => { renderPill(); renderModal(); });
  together.addEventListener('info', (e) => toast(e.detail.msg, e.detail.kind ? { kind: e.detail.kind } : {}));
  renderPill();
}

/** Buka jendela Dengar Bareng; joinCode (opsional) dari link undangan. */
export function openTogether(joinCode = '') {
  // Browser menahan pemutaran otomatis: ketukan ini sekaligus melanjutkan lagu
  if (!joinCode && together.mode === 'guest' && together.needTap) { together.resumeAudio(); return; }
  pendingJoinCode = joinCode;
  if (modalOpen()) { renderModal(); return; }
  modal = openModal({ title: 'Dengar Bareng', body: '<div id="togetherBody"></div>', className: 'together-modal', onOpen: () => setTimeout(renderModal, 0) });
}

function renderPill() {
  const pill = $('#togetherPill');
  if (!pill) return;
  const m = together.mode;
  pill.hidden = m === 'idle';
  document.body.classList.toggle('tg-on', m !== 'idle');
  if (m === 'idle') return;
  let text = 'Menyambungkan…';
  if (m === 'host') {
    const n = together.guests.size;
    text = n ? `Dengar Bareng · ${n} teman` : `Dengar Bareng · kode ${fmtCode(together.code)}`;
  } else if (m === 'guest') {
    if (together.needTap) text = 'Ketuk untuk melanjutkan';
    else if (together.reconnecting) text = 'Menyambung ulang…';
    else text = together.incoming ? `Menerima lagu ${together.recvPct}%` : `Bersama ${together.hostName || 'teman'}`;
  }
  pill.innerHTML = `${icon(m === 'guest' && together.needTap ? 'play' : 'users')}<span>${esc(text)}</span>`;
  pill.classList.toggle('live', (m === 'host' || m === 'guest') && !together.reconnecting);
  pill.classList.toggle('warn', m === 'guest' && (together.reconnecting || together.needTap));
}

function nameField() {
  return `<label class="field"><span>Nama kamu (terlihat oleh teman)</span><input class="input" id="tgName" maxlength="30" value="${esc(store.settings.togetherName || '')}" placeholder="mis. Syarafat"></label>`;
}

function saveName(root) {
  const v = (root.querySelector('#tgName')?.value || '').trim();
  if (v !== (store.settings.togetherName || '')) store.saveSettings({ togetherName: v });
  return v || 'Teman';
}

/** Jendela masih terbuka (bukan sedang dalam animasi menutup). */
function modalOpen() {
  return !!(modal && modal.root.isConnected && modal.root.parentElement && !modal.root.parentElement.dataset.closing);
}

function awakeToggle() {
  if (!('wakeLock' in navigator)) return '';
  return `<label class="check tg-awake"><input type="checkbox" id="tgAwake" ${together.keepAwake ? 'checked' : ''}><span><b>Layar tetap menyala</b> selama sesi — koneksi lebih stabil (lebih boros baterai)</span></label>`;
}

function bindAwake(body) {
  const el = body.querySelector('#tgAwake');
  if (el) el.addEventListener('change', () => together.setKeepAwake(el.checked));
}

function renderModal() {
  const body = modalOpen() ? modal.root.querySelector('#togetherBody') : null;
  if (!body) return;
  const m = together.mode;
  if (m === 'idle') {
    body.innerHTML = `
      <p class="modal-text">Putar lagu yang sama di dua HP (atau lebih) <b>secara bersamaan</b>. HP yang membuat sesi memilih lagu; HP teman ikut memutar di detik yang sama — teman tidak perlu punya lagunya.</p>
      ${nameField()}
      <button class="btn primary tg-wide" data-tg="host">${icon('users')} Buat sesi di HP ini</button>
      <div class="tg-or"><span>atau gabung ke sesi teman</span></div>
      <form class="tg-join" id="tgJoin">
        <input class="input tg-code" id="tgCode" inputmode="numeric" autocomplete="off" maxlength="7" placeholder="Kode 6 angka" value="${esc(fmtCode(pendingJoinCode))}">
        <button class="btn ghost" type="submit">Gabung</button>
      </form>
      <p class="tg-note">${icon('info')} Butuh internet di kedua HP. Kode & sambungan diatur lewat server PeerJS (gratis, sumber terbuka); lagu dikirim langsung antar-HP dan <b>tidak disimpan</b> di HP teman.</p>`;
    body.querySelector('[data-tg="host"]').addEventListener('click', async () => {
      const name = saveName(body);
      try { await together.host(name); } catch (e) { toast(e.message, { kind: 'warn', timeout: 7000 }); }
    });
    const codeInput = body.querySelector('#tgCode');
    codeInput.addEventListener('input', () => {
      const d = codeInput.value.replace(/\D/g, '').slice(0, 6);
      codeInput.value = d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
    });
    body.querySelector('#tgJoin').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = saveName(body);
      try { await together.join(codeInput.value, name); pendingJoinCode = ''; } catch (err) { toast(err.message, { kind: 'warn', timeout: 7000 }); }
    });
    if (pendingJoinCode) setTimeout(() => body.querySelector('#tgJoin button').focus(), 50);
    else if (!isMobile()) setTimeout(() => body.querySelector('#tgName').focus(), 50);
    return;
  }
  if (m === 'connecting') {
    body.innerHTML = `<div class="tg-wait"><div class="tg-spin"></div><p>Menyambungkan…</p></div>`;
    return;
  }
  if (m === 'host') {
    const guests = [...together.guests.values()];
    body.innerHTML = `
      <p class="modal-text">Minta teman membuka aplikasi ini lalu masukkan kode, atau kirim link undangan.</p>
      <div class="tg-codebox"><small>KODE SESI</small><strong>${esc(fmtCode(together.code))}</strong></div>
      <div class="btn-row center tg-share">
        <button class="btn primary" data-tg="share">${icon('link')} Kirim undangan</button>
        <button class="btn ghost" data-tg="copy">Salin kode</button>
      </div>
      <h3 class="tg-sub">Teman tersambung (${guests.length})</h3>
      <div class="tg-guests">${guests.length ? guests.map((g) => `
        <div class="tg-guest"><div class="tg-ava">${esc(g.name.slice(0, 1).toUpperCase())}</div><span><b>${esc(g.name)}</b><small>${esc(g.status)}</small></span></div>`).join('') : '<p class="muted small">Belum ada. Kode ini aktif selama aplikasi tetap terbuka.</p>'}
      </div>
      <p class="tg-note">${icon('info')} Putar lagu seperti biasa — HP teman ikut otomatis. Teman juga bisa menekan putar/jeda/ganti lagu. Jika sinyal teman putus sebentar, ia tersambung kembali otomatis.</p>
      ${awakeToggle()}
      <button class="btn danger tg-wide" data-tg="end">Akhiri sesi</button>`;
    bindAwake(body);
    body.querySelector('[data-tg="share"]').addEventListener('click', () => shareInvite(together.code));
    body.querySelector('[data-tg="copy"]').addEventListener('click', () => copyText(together.code, 'Kode disalin'));
    body.querySelector('[data-tg="end"]').addEventListener('click', () => { together.leave('Sesi diakhiri'); });
    return;
  }
  if (m === 'guest') {
    const st = together.state;
    const s = st && st.song;
    const delay = together.delayMs;
    let status = 'Menunggu lagu dari pembuat sesi…';
    if (together.reconnecting) status = 'Sinyal terputus — menyambung ulang… (lagu tetap diputar)';
    else if (together.incoming) status = `Menerima lagu… ${together.recvPct}%`;
    else if (s && s.unsupported) status = 'Lagu ini tidak bisa diputar bersama';
    else if (s && together.ready) status = st.playing ? `Tersinkron${Math.abs(together.drift) < 0.08 ? '' : ' (menyesuaikan…)'}` : 'Dijeda oleh pembuat sesi';
    body.innerHTML = `
      <div class="tg-hostbox"><div class="tg-ava big">${esc((together.hostName || '?').slice(0, 1).toUpperCase())}</div><span><small>MENDENGAR BERSAMA</small><b>${esc(together.hostName || 'Teman')}</b><em>${esc(status)}</em></span></div>
      ${s ? `<p class="tg-now">${icon('note')} <b>${esc(s.title)}</b> · ${esc(s.artist)}</p>` : ''}
      ${together.needTap ? `<button class="btn primary tg-wide" data-tg="tap">${icon('play')} Ketuk untuk mulai mendengar</button>` : ''}
      <h3 class="tg-sub">Tidak pas? Atur jeda HP ini</h3>
      <p class="muted small">Berguna bila salah satu HP memakai earphone Bluetooth (biasanya ada jeda).</p>
      <div class="tg-delay">
        <button class="btn ghost sm" data-tg="earlier">− 0,1 dtk</button>
        <span>${delay === 0 ? 'Tanpa penyesuaian' : `${delay > 0 ? 'Lebih lambat' : 'Lebih cepat'} ${(Math.abs(delay) / 1000).toFixed(1).replace('.', ',')} dtk`}</span>
        <button class="btn ghost sm" data-tg="later">+ 0,1 dtk</button>
      </div>
      ${awakeToggle()}
      <button class="btn danger tg-wide" data-tg="leave">Keluar dari sesi</button>`;
    bindAwake(body);
    body.querySelector('[data-tg="earlier"]').addEventListener('click', () => together.setDelay(delay - 100));
    body.querySelector('[data-tg="later"]').addEventListener('click', () => together.setDelay(delay + 100));
    body.querySelector('[data-tg="leave"]').addEventListener('click', () => together.leave('Kamu keluar dari sesi'));
    const tap = body.querySelector('[data-tg="tap"]');
    if (tap) tap.addEventListener('click', () => together.resumeAudio());
  }
}

async function shareInvite(code) {
  const url = inviteUrl(code);
  const text = `Ayo dengar lagu bareng! Buka link ini lalu ketuk Gabung (kode: ${fmtCode(code)})`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Dengar Bareng', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  copyText(`${text}\n${url}`, 'Link undangan disalin — tempel di WhatsApp');
}

async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); } catch { toast(text, { timeout: 8000 }); }
}

// ---------- Putar ke beberapa perangkat Bluetooth (fitur bawaan HP) ----------
export function openBluetoothHelp() {
  openModal({
    title: 'Putar ke beberapa earphone/speaker',
    body: `
      <p class="modal-text">Suara aplikasi ini keluar ke perangkat yang dipilih <b>HP kamu</b>. Jika HP-mu punya fitur <b>berbagi audio Bluetooth</b> (ikon headset bertumpuk di daftar perangkat), lagu bisa keluar di <b>dua perangkat sekaligus</b>:</p>
      <ol class="bt-steps">
        <li>Sambungkan (pairing) kedua earphone/speaker di <b>Pengaturan → Bluetooth</b>.</li>
        <li>Putar lagu di aplikasi ini.</li>
        <li>Tarik panel notifikasi, lalu di kontrol musik ketuk <b>ikon perangkat/keluaran audio</b>.</li>
        <li>Ketuk perangkat kedua yang punya ikon berbagi audio, sampai <b>keduanya aktif</b>. Volume masing-masing bisa diatur di sana.</li>
      </ol>
      <p class="tg-note">${icon('info')} Nama fiturnya berbeda tiap merek: <b>Berbagi audio</b> (Xiaomi/POCO, OPPO, realme, vivo), <b>Dual Audio</b> atau <b>Auracast</b> (Samsung). Umumnya maksimal 2 perangkat, tergantung HP. Aplikasi web tidak bisa memilih perangkat Bluetooth sendiri, jadi pengaturannya lewat HP.</p>
      <div class="bt-alt">${icon('users')}<span>Mau mendengar di <b>HP yang berbeda</b>? Pakai <b>Dengar Bareng</b>.</span><button class="btn ghost sm" data-bt="together">Buka</button></div>`,
    actions: [{ label: 'Mengerti', kind: 'primary' }],
    onOpen: (root, api) => {
      root.querySelector('[data-bt="together"]').addEventListener('click', () => { api.close(); setTimeout(() => openTogether(), 300); });
    },
  });
}
