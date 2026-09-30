'use strict';

// Network first, cache as a fallback: after a server update every device gets the
// new app on its next load, and the last good copy still opens when offline.
const CACHE = 'agent-bridge-shell-v3';
const SHELL = [
  '/', '/app.js', '/style.css', '/manifest.webmanifest',
  '/icon.svg', '/icon-512.png', '/apple-touch-icon.png',
  '/happydev/', '/happydev/core.js',
  '/happydev/games/flappy.js', '/happydev/games/dash.js',
  '/happydev/games/wings.js', '/happydev/games/stack.js',
  '/happydev/games/snake.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/ws' || url.pathname.startsWith('/local/')) return;
  const key = event.request.mode === 'navigate' ? '/' : event.request;
  event.respondWith(fetch(event.request, { cache: 'no-cache' }).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(key, copy));
    }
    return response;
  }).catch(() => caches.match(key).then((cached) => cached || Response.error())));
});
