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
- **Video otomatis diubah jadi MP3**: pilih video (MP4, WEBM, MOV, MKV, 3GP) dan aplikasi
  mengambil suaranya saja lalu menyimpannya sebagai MP3 128 kbps. Videonya tidak disimpan,
  jadi hemat memori. Semua diproses di perangkat, tanpa internet.
- **Acak (shuffle)**: tombol *Acak semua lagu* di Beranda, tombol 🔀 di pemutar (juga di
  pemutar mini HP), dan tombol *Acak* di Pustaka, playlist, artis, dan album.
- **Beberapa folder sekaligus**: ketuk *Pilih folder* berulang kali untuk mengumpulkan
  beberapa folder; lagu di semua subfolder ikut dicari, diurutkan per folder & nama file
  (1, 2, … 10), lalu ditambahkan sekaligus. Opsional: satu **playlist untuk tiap folder**.
- **Anti dobel**: file yang sama dikenali dari isinya (walau namanya diganti atau ada di
  folder lain) dan otomatis dilewati. Di *Pengaturan → Lagu dobel* ada tombol untuk
  membersihkan lagu dobel lama (status suka, jumlah putar, dan playlist dipertahankan).
- **Dengar Bareng**: putar lagu yang sama di dua HP (atau lebih, maks. 6 teman) di detik
  yang sama. Satu HP membuat sesi dan mendapat kode 6 angka / link undangan; HP teman
  bergabung dan ikut memutar — teman tidak perlu punya lagunya. Putar, jeda, geser, dan
  ganti lagu tersinkron; teman juga bisa menekan putar/jeda/ganti lagu.
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

## Menambah video (diubah ke MP3)

Buka **Tambah → Pilih lagu / video**, lalu pilih video dari galeri atau folder HP. Bisa
dicampur dengan file MP3 dan bisa banyak sekaligus. Untuk setiap video, aplikasi akan:

1. **mengambil foto sampul lebih dulu**: foto sampul yang tersimpan di dalam file video
   (MP4 atau lampiran "cover" di MKV) bila ada; jika tidak ada, aplikasi mengecek beberapa
   cuplikan video dan memilih gambar yang paling jelas (bukan layar hitam). Sampul langsung
   tampil di kartu progres,
2. mengambil suaranya lalu mengubahnya menjadi **MP3** (128 kbps) — videonya tidak disimpan,
3. membaca judul/artis dari info video atau dari nama file (mis. `Artis - Judul.mp4`).

Sampul bisa diganti kapan saja lewat menu ⋯ → *Edit info lagu* → *Ganti sampul*.

Lama proses biasanya beberapa detik sampai ±1 menit per lagu, tergantung panjang video dan
kecepatan HP. Biarkan aplikasi tetap terbuka sampai selesai. Batas ukuran video 350 MB.
Video tanpa suara atau format yang tidak didukung browser (mis. AVI/WMV) akan dilewati
dengan pesan.

## Dengar Bareng (dua HP, lagu sama, bersamaan)

1. Di HP pertama: ketuk **Dengar Bareng** (di Beranda, atau di layar *Sedang diputar*) →
   isi nama → **Buat sesi di HP ini**. Muncul **kode 6 angka**.
2. Ketuk **Kirim undangan** untuk mengirim link lewat WhatsApp, atau sebutkan kodenya.
3. Di HP teman: buka link undangan (atau buka aplikasi → *Dengar Bareng* → masukkan kode)
   → **Gabung**.
4. Putar lagu seperti biasa di HP pertama. HP teman ikut memutar lagu yang sama di detik
   yang sama. Teman juga bisa menekan putar/jeda/berikutnya.

Cara kerja & catatan:

- Butuh **internet** di kedua HP selama sesi. Sambungan diatur lewat server
  [PeerJS](https://peerjs.com) (gratis, sumber terbuka); lagu dikirim **langsung antar-HP**
  (atau lewat server perantara PeerJS bila jaringan tidak memungkinkan sambungan langsung).
- Lagu yang dikirim hanya disimpan sementara di memori HP teman — **tidak masuk** ke
  pustakanya. Jika HP teman sudah punya lagu yang sama, lagunya langsung dipakai tanpa dikirim.
- Kode aktif selama aplikasi di HP pembuat sesi tetap terbuka.
- **Tahan sinyal putus**: perintah (putar/jeda/posisi) dan kiriman lagu memakai jalur
  terpisah, sehingga perintah tidak tertahan saat lagu sedang dikirim. Bila sambungan teman
  putus atau macet, lagunya **tetap diputar** dan aplikasi **menyambung ulang otomatis**
  (hingga 3 menit). Bila browser menahan pemutaran, muncul tombol *Ketuk untuk melanjutkan*.
- Opsi *Layar tetap menyala selama sesi* membuat koneksi lebih stabil (lebih boros baterai).
- Pakai earphone Bluetooth dan terasa tidak pas? Di HP teman: *Dengar Bareng → Atur jeda HP ini*.

## Dua earphone/speaker Bluetooth di satu HP

Aplikasi web tidak bisa memilih perangkat Bluetooth sendiri — suara mengikuti pilihan HP.
Jika HP punya fitur **berbagi audio Bluetooth** (Xiaomi/POCO, OPPO, realme, vivo: *Berbagi
audio*; Samsung: *Dual Audio*/*Auracast*): sambungkan kedua perangkat, putar lagu, buka
kontrol musik di panel notifikasi → ikon keluaran audio → aktifkan perangkat kedua. Panduan
ini juga ada di aplikasi (tombol 🔈 di layar *Sedang diputar*, atau *Pengaturan → Dengar berdua*).

## Dari mana dapat lagu?## Dengar Bareng (dua HP, lagu sama, bersamaan)

1. Di HP pertama: ketuk **Dengar Bareng** (di Beranda, atau di layar *Sedang diputar*) →
   isi nama → **Buat sesi di HP ini**. Muncul **kode 6 angka**.
2. Ketuk **Kirim undangan** untuk mengirim link lewat WhatsApp, atau sebutkan kodenya.
3. Di HP teman: buka link undangan (atau buka aplikasi → *Dengar Bareng* → masukkan kode)
   → **Gabung**.
4. Putar lagu seperti biasa di HP pertama. HP teman ikut memutar lagu yang sama di detik
   yang sama. Teman juga bisa menekan putar/jeda/berikutnya.

Cara kerja & catatan:

- Butuh **internet** di kedua HP selama sesi. Sambungan diatur lewat server
  [PeerJS](https://peerjs.com) (gratis, sumber terbuka); lagu dikirim **langsung antar-HP**
  (atau lewat server perantara PeerJS bila jaringan tidak memungkinkan sambungan langsung).
- Lagu yang dikirim hanya disimpan sementara di memori HP teman — **tidak masuk** ke
  pustakanya. Jika HP teman sudah punya lagu yang sama, lagunya langsung dipakai tanpa dikirim.
- Kode aktif selama aplikasi di HP pembuat sesi tetap terbuka.
- **Tahan sinyal putus**: perintah (putar/jeda/posisi) dan kiriman lagu memakai jalur
  terpisah, sehingga perintah tidak tertahan saat lagu sedang dikirim. Bila sambungan teman
  putus atau macet, lagunya **tetap diputar** dan aplikasi **menyambung ulang otomatis**
  (hingga 3 menit). Bila browser menahan pemutaran, muncul tombol *Ketuk untuk melanjutkan*.
- Opsi *Layar tetap menyala selama sesi* membuat koneksi lebih stabil (lebih boros baterai).
- Pakai earphone Bluetooth dan terasa tidak pas? Di HP teman: *Dengar Bareng → Atur jeda HP ini*.

## Dua earphone/speaker Bluetooth di satu HP

Aplikasi web tidak bisa memilih perangkat Bluetooth sendiri — suara mengikuti pilihan HP.
Jika HP punya fitur **berbagi audio Bluetooth** (Xiaomi/POCO, OPPO, realme, vivo: *Berbagi
audio*; Samsung: *Dual Audio*/*Auracast*): sambungkan kedua perangkat, putar lagu, buka
kontrol musik di panel notifikasi → ikon keluaran audio → aktifkan perangkat kedua. Panduan
ini juga ada di aplikasi (tombol 🔈 di layar *Sedang diputar*, atau *Pengaturan → Dengar berdua*).

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
js/convert.js         video → MP3 (suara via Web Audio) + sampul (bawaan MP4/MKV atau cuplikan terbaik)
js/mp3worker.js       encoder MP3 di Web Worker
js/vendor/lame.min.js lamejs (LAME MP3 encoder), LGPL-3.0 — lihat js/vendor/LAME-LICENSE.txt
js/together.js        Dengar Bareng: sesi, sinkronisasi jam & posisi, kirim lagu antar-HP
js/togetherui.js      tampilan Dengar Bareng
js/vendor/peerjs.min.js PeerJS (WebRTC), MIT — lihat js/vendor/PEERJS-LICENSE.txt
js/ytengine.js        pemutar YouTube (hanya untuk lagu YouTube yang sudah terlanjur ditambahkan)
js/metadata.js        pembaca tag ID3/FLAC/MP4/Ogg/WAV
js/store.js, db.js    data di memori + IndexedDB
sw.js                 service worker (offline & share target)
```

Tidak ada *build step*. Pustaka luar (disertakan di repo): lamejs (encoder MP3) dan PeerJS (Dengar Bareng). Setiap kali mengubah file aplikasi,
**naikkan `VERSION` di `sw.js`** agar pengguna mendapat notifikasi "Versi baru tersedia".
Nama aplikasi bisa diganti di `index.html`, `manifest.webmanifest`, dan `APP_NAME` di `js/views.js`.
