/* Service worker: makes the installed game work with no connection.
 *
 * The whole game is one HTML file plus three icons, so caching is simple —
 * grab them on install, and serve from the cache first afterwards. Bumping
 * CACHE below is what makes an installed phone pick up a new version.
 */
const CACHE = 'hokm-v1';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  // Drop older caches so a new version does not sit behind an old one forever.
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Cache first: the game must open instantly and offline. The network is only
  // a fallback, and a fresh copy quietly replaces the cached one when it works.
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const live = fetch(e.request).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || live;
    })
  );
});
