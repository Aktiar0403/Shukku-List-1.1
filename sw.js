const CACHE_NAME = "shukku-list-v1";
const urlsToCache = [
  "/",
  "index.html",
  "login.html",
  "style.css",
  "app.js",
  "auth.js",
  "firebase-config.js",
  "manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(caches.match(event.request).then((response) => {
    return response || fetch(event.request);
  }).catch(() => caches.match("index.html")));
});
