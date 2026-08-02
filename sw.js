// sw.js — Service worker: cachea el shell de la app para funcionar 100% offline.
// Estrategia: cache-first para archivos propios, network-first para el resto
// (tiles de mapa y APIs siempre van a la red; si no hay red, fallan con gracia).
const CACHE = 'lifetime-game-v3';
const ARCHIVOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/ui.js',
  './js/modules/dashboard.js',
  './js/modules/estudio.js',
  './js/modules/tiempo.js',
  './js/modules/dieta.js',
  './js/modules/notas.js',
  './js/modules/economia.js',
  './js/modules/ubicacion.js',
  './js/modules/musica.js',
  './js/modules/google.js',
  './js/modules/ajustes.js',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  // Archivos propios: "stale-while-revalidate".
  // Responde YA desde el cache (rápido y funciona sin internet) y, en paralelo,
  // baja la versión nueva para el próximo arranque. Sin esto, una app instalada
  // se quedaría con el código viejo para siempre después de una actualización.
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cacheada => {
        const red = fetch(e.request).then(r => {
          if (r && r.ok) cache.put(e.request, r.clone());
          return r;
        }).catch(() => null);
        return cacheada || red.then(r => r || new Response('Sin conexión', { status: 503 }));
      })
    )
  );
});

// La página puede pedir que el SW nuevo tome el control sin esperar.
self.addEventListener('message', (e) => { if (e.data === 'actualizar') self.skipWaiting(); });

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(cs => {
    if (cs.length) return cs[0].focus();
    return clients.openWindow('./');
  }));
});
