'use strict';

const CACHE = 'agent-bridge-shell-v2';
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
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/ws') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/')));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});
