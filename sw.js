/*
 * Fa funzionare l'app anche senza internet.
 * Con la rete: scarica sempre la versione piu' recente e ne tiene una copia.
 * Senza rete: usa l'ultima copia salvata.
 */
var CACHE = 'cap-album-v1';
var SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css',
  'lib/htm-preact.umd.js',
  'js/icc.js', 'js/layout.js', 'js/storage.js', 'js/export.js', 'js/session.js', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.png'
];
var shellUrls = SHELL.map(function (p) { return new URL(p, self.registration.scope).pathname; });

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(SHELL.map(function (p) { return new Request(p, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (shellUrls.indexOf(url.pathname) < 0) return;   // solo i file del programma
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(url.pathname, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(url.pathname).then(function (hit) {
        return hit || caches.match(new URL('./', self.registration.scope).pathname);
      });
    })
  );
});
