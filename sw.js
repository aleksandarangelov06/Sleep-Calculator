/* Service worker for Sleep Calculator.
   Caches the app shell so it works offline and can be installed to a phone. */
const CACHE = 'sleep-calc-v8';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './manifest.webmanifest',
  './images/pwa-icon.svg',
  './images/pwa-64x64.png',
  './images/pwa-192x192.png',
  './images/pwa-512x512.png',
  './images/apple-touch-icon-180x180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Navigations: network-first so updates show, fall back to cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Other GETs: cache-first, fall back to network and cache the result.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((resp) => {
        if (resp.ok && new URL(request.url).origin === self.location.origin) {
          const copy = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return resp;
      });
    })
  );
});
