// Service worker: installable + works offline (network first, cached fallback)
const CACHE = 'padel-center-v20';
const ASSETS = ['./', './index.html', './style.css', './cloud.js', './app.js', './players.js', './record.js', './ui.js', './manifest.json', './padel_app_icon.png', './padel_app_icon_512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ASSETS.map(a => c.add(a).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // analytics/fonts pass through
  if (url.pathname.includes('/api/')) return;                         // database calls always go to the network
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
