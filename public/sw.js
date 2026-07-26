// Service worker de Corrientes (PWA).
// - Instalabilidad + arranque rápido + funcionamiento básico offline (shell).
// - NUNCA cachea /api (datos por-usuario → siempre a la red).
// - Assets estáticos van versionados con ?v= → cache-first es seguro (cada
//   cambio es una URL nueva). La navegación es red-primero (siempre fresco online).
const CACHE = 'corrientes-v1';
const SHELL = ['/', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // solo mismo origen
  if (url.pathname.startsWith('/api')) return;        // API: red directa, sin cache

  if (req.mode === 'navigate') {
    // Navegación: red primero, y guardo index como respaldo offline.
    e.respondWith(
      fetch(req)
        .then((r) => { caches.open(CACHE).then((c) => c.put('/', r.clone())); return r; })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Estáticos (css/js/svg, versionados): cache primero, si no está va a la red.
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((r) => {
      if (r.ok) { const clone = r.clone(); caches.open(CACHE).then((c) => c.put(req, clone)); }
      return r;
    })),
  );
});
