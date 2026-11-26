# 🎵 Lagu Syarafat

Aplikasi pemutar musik pribadi, khusus untuk mendengarkan lagu **tanpa gangguan**:
tanpa iklan, tanpa akun, tanpa pelacakan. Semua lagu disimpan **di perangkatmu sendiri**
dan bisa diputar **tanpa internet**. Tampilannya terinspirasi aplikasi musik modern
(tema gelap, sidebar pustaka, bar pemutar di bawah, layar "Sedang diputar").

Aplikasi ini berupa *Progressive Web App* (PWA): dibuka lewat browser, lalu bisa
**dipasang ke layar utama HP/laptop** sehingga terbuka seperti aplikasi biasa.

## Fitur

- **Tambah lagu** dari file di HP/laptop (bisa banyak sekaligus atau satu folder),
  seret-lepas di laptop, dari **link** file audio, atau lewat menu **Bagikan** di Android.
- **Hapus lagu**: satu per satu (menu ⋯ → *Hapus lagu dari perangkat*) atau banyak
  sekaligus (tombol **Pilih** → centang → 🗑).
- Judul, artis, album, dan **sampul dibaca otomatis** dari file (MP3, M4A, FLAC, OGG, OPUS, WAV).
  Kalau file tidak punya info, judul & artis ditebak dari nama file. Bisa diedit manual.
- **Playlist** (buat, ganti nama, hapus, tambah/hapus lagu, urungkan), **Lagu Disukai** ❤.
- Halaman **Artis** dan **Album** otomatis, **pencarian**, pengurutan pustaka.
- Pemutar lengkap: putar/jeda, berikutnya/sebelumnya, geser posisi, **acak**, **ulangi**
  (semua/satu), volume, **antrean** (putar berikutnya, tambah ke antrean, atur urutan),
  **timer tidur**.
- **Kontrol di layar kunci / notifikasi / tombol headset** (Media Session).
- Melanjutkan lagu terakhir saat aplikasi dibuka lagi.
- 6 pilihan **warna aksen**, pintasan keyboard di laptop, tampilan HP & laptop.

## Cara membuka aplikasinya

Aplikasi ini hanya berisi file statis (HTML/CSS/JS), jadi cukup di-*hosting* di mana saja.

### Pilihan A — GitHub Pages (gratis, butuh repo **public**)

1. Di GitHub buka **Settings → General → Danger Zone → Change visibility → Public**
   (GitHub Pages untuk repo *private* butuh akun berbayar).
2. Buka **Settings → Pages**. Pada *Build and deployment* pilih **Deploy from a branch**,
   pilih branch yang berisi kode ini dan folder **/ (root)**, lalu **Save**.
3. Tunggu ±1 menit, lalu buka `https://syarafat.github.io/khusus-lagu-syarafat/`.

> Lagu kamu **tidak ikut terunggah ke GitHub** — lagu hanya tersimpan di browser
> perangkatmu. Yang publik hanya kode aplikasinya.

### Pilihan B — Tetap private: Netlify / Cloudflare Pages / Vercel (gratis)

Hubungkan repo ini di salah satu layanan tersebut. Tidak perlu *build command*;
*publish directory* = folder utama (root).

### Pilihan C — Coba di komputer sendiri

```bash
python3 -m http.server 8000
# lalu buka http://localhost:8000
```

> Membuka `index.html` langsung dengan klik dua kali (alamat `file://`) **tidak** akan berjalan.

## Memasang ke layar utama

- **Android (Chrome):** buka link aplikasi → menu **⋮** → *Instal aplikasi* /
  *Tambahkan ke layar utama*. Setelah terpasang, kamu juga bisa membagikan file lagu
  dari aplikasi File: *Bagikan → Lagu Syarafat*.
- **iPhone/iPad (Safari):** tombol *Bagikan* → *Tambah ke Layar Utama*.
- **Laptop (Chrome/Edge):** klik ikon pasang di ujung kanan kolom alamat.

Mau file **APK** sungguhan? Setelah aplikasi online, masukkan link-nya di
[PWABuilder](https://www.pwabuilder.com) untuk membuat paket Android.

## Dari mana dapat lagu?

Di dalam aplikasi ada halaman **Tambah Lagu → Dari mana dapat lagu?** Ringkasnya:

| Sumber | Keterangan |
| --- | --- |
| File milikmu | MP3/M4A di folder *Download*, *Music*, *WhatsApp Audio*, atau dari laptop |
| [Jamendo](https://www.jamendo.com) | Lagu musisi independen, gratis untuk didengar pribadi |
| [Free Music Archive](https://freemusicarchive.org) | Musik berlisensi Creative Commons |
| [Internet Archive](https://archive.org/details/audio) | Rekaman domain publik & netlabel |
| [Pixabay Music](https://pixabay.com/music/) | Musik bebas royalti |
| [YouTube Audio Library](https://studio.youtube.com) | Musik gratis dari YouTube Studio |
| [Bandcamp](https://bandcamp.com) | Beli langsung dari musisi, unduh MP3/FLAC |
| [iTunes Store](https://www.apple.com/itunes/) | Lagu yang dibeli bisa diunduh sebagai M4A |

Lagu yang "diunduh" di Spotify/Joox/YouTube Music/Apple Music terkunci DRM dan tidak bisa
dipindahkan ke aplikasi lain.

## Penting soal penyimpanan

- Lagu tersimpan di **browser pada perangkat itu saja** (IndexedDB). Lagu di HP tidak
  otomatis muncul di laptop, begitu juga sebaliknya.
- **Menghapus data/riwayat situs di browser akan menghapus lagu.** Jangan pakai mode penyamaran.
- Pasang aplikasinya dan aktifkan *Pengaturan → Penyimpanan → Jaga lagu agar tidak terhapus
  otomatis* supaya browser tidak membersihkan lagu saat memori hampir penuh.

## Untuk pengembang

```
index.html            kerangka halaman
css/style.css         seluruh tampilan
js/app.js             routing, event, impor, PWA
js/views.js           halaman-halaman (Beranda, Pustaka, Playlist, dst.)
js/player.js          mesin pemutar, antrean, Media Session, timer tidur
js/playerui.js        bar pemutar, layar "Sedang diputar", panel antrean
js/actions.js         menu lagu, playlist, edit, hapus
js/importer.js        proses tambah lagu (file & link), sampul
js/metadata.js        pembaca tag ID3/FLAC/MP4/Ogg/WAV
js/store.js, db.js    data di memori + IndexedDB
sw.js                 service worker (offline & share target)
```

Tidak ada *build step* dan tidak ada dependensi luar. Setiap kali mengubah file aplikasi,
**naikkan `VERSION` di `sw.js`** agar pengguna mendapat notifikasi "Versi baru tersedia".
Nama aplikasi bisa diganti di `index.html`, `manifest.webmanifest`, dan `APP_NAME` di `js/views.js`.
