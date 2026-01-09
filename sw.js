/* Simple SW: cache-first for app assets + runtime cache for CDN libs */
const CACHE = "wmstamp-v1";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./watermarks/WM1.1.png",
  "./watermarks/WM1.2.png",
  "./watermarks/WM1.3.png",
  "./watermarks/WM2.1.png",
  "./watermarks/WM2.2.png",
  "./watermarks/WM2.3.png",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./vendor/pdf-lib.min.js",

];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Cache-first for same-origin assets
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // Runtime cache for CDN libs (stale-while-revalidate)
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const fetchPromise = fetch(req).then(res => {
      cache.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || fetchPromise;
  })());
});
