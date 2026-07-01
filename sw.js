// Service Worker untuk PWA Dashboard KPI MKI Makassar
const CACHE_NAME = 'mki-kinerja-v1';
const STATIC_ASSETS = [
  '/Kinerja-Cabang-Makassar/',
  '/Kinerja-Cabang-Makassar/index.html',
  '/Kinerja-Cabang-Makassar/calc.js',
  '/Kinerja-Cabang-Makassar/render.js',
  '/Kinerja-Cabang-Makassar/app.js',
  '/Kinerja-Cabang-Makassar/data-loader.js',
];

// Install: cache file statis
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: hapus cache lama
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first untuk data Google Sheets, cache-first untuk assets
self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  // Data Google Sheets selalu dari network (data real-time)
  if (url.includes('docs.google.com') || url.includes('spreadsheets')) {
    return; // biarkan browser handle, tidak di-cache
  }
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Update cache dengan versi terbaru
        if (res.ok && !url.includes('chrome-extension')) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, resClone));
        }
        return res;
      })
      .catch(() => caches.match(e.request)) // fallback ke cache jika offline
  );
});
