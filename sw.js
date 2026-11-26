// Service worker: membuat aplikasi bisa dibuka tanpa internet & menerima file yang dibagikan.
// Naikkan VERSION setiap kali file aplikasi diubah agar pengguna mendapat versi baru.
const VERSION = 'v1.1.0';
const CACHE = `lagu-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/actions.js',
  'js/db.js',
  'js/icons.js',
  'js/importer.js',
  'js/metadata.js',
  'js/player.js',
  'js/playerui.js',
  'js/store.js',
  'js/ui.js',
  'js/views.js',
  'js/ytengine.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('lagu-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // file audio dari link luar: langsung ke jaringan

  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(handleShare(req));
    return;
  }
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match('index.html', { cacheName: CACHE });
      if (cached) return cached;
      try { return await fetch(req); } catch { return new Response('Offline', { status: 503 }); }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true, cacheName: CACHE });
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  })());
});

// ---------- Share target: "Bagikan → Lagu Syarafat" di Android ----------
function openInbox() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('lagu-inbox', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files', { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function handleShare(request) {
  const back = (q) => Response.redirect(new URL(`./?shared=${q}#/add`, self.registration.scope).href, 303);
  try {
    const form = await request.formData();
    const files = form.getAll('audio').filter((f) => f && typeof f !== 'string');
    // Link yang dibagikan dari aplikasi YouTube / YouTube Music (atau browser)
    const text = ['url', 'text', 'title'].map((k) => form.get(k)).filter((v) => typeof v === 'string' && v).join(' ');
    const links = text.match(/https?:\/\/[^\s<>"']+/g) || [];
    const items = [...files, ...links];
    const db = await openInbox();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      items.forEach((f) => tx.objectStore('files').add(f));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return back(items.length ? '1' : 'error');
  } catch (err) {
    return back('error');
  }
}
