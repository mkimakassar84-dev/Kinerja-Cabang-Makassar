// Service Worker untuk PWA Dashboard KPI MKI Makassar
const CACHE_NAME = 'mki-kinerja-v4';
const STATIC_ASSETS = [
  '/Kinerja-Cabang-Makassar/',
  '/Kinerja-Cabang-Makassar/index.html',
  '/Kinerja-Cabang-Makassar/calc.js',
  '/Kinerja-Cabang-Makassar/render.js',
  '/Kinerja-Cabang-Makassar/app.js',
  '/Kinerja-Cabang-Makassar/data-loader.js',
];

// Install: cache file statis (bypass HTTP cache biar gak ke-poison sama versi lama)
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(STATIC_ASSETS.map(url =>
        fetch(new Request(url, { cache: 'reload' })).then(res => {
          if (res.ok) return cache.put(url, res);
        }).catch(() => {})
      ))
    )
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
  // File statis dashboard (html/js) selalu ambil versi terbaru dari network,
  // bypass HTTP cache browser agar update selalu langsung tersedia (termasuk di HP)
  const isStaticAsset = url.includes('/Kinerja-Cabang-Makassar/') && /\.(html|js)$/.test(url.split('?')[0]) || url.endsWith('/Kinerja-Cabang-Makassar/');
  const fetchReq = isStaticAsset ? new Request(e.request, { cache: 'no-store' }) : e.request;
  e.respondWith(
    fetch(fetchReq)
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
