const CACHE = 'melhora-cache-v3';
const STATIC_FILES = [
  '/',
  '/style.css',
  '/app.js',
  '/pwa/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(STATIC_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('/api/')) {
    e.respondWith(fetch(e.request).catch(() => new Response(JSON.stringify({offline: true}), {status: 503})));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => {
      if (e.request.mode === 'navigate') return caches.match('/');
      return new Response('Offline', {status: 503});
    }))
  );
});

self.addEventListener('push', (e) => {
  const data = e.data?.json() || {};
  self.registration.showNotification(data.title || 'Melhora App Live', {
    body: data.body || 'Você tem uma notificação',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' }
  });
});
