const CACHE_NAME = "caderno-v7";

const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./css/app.css?v=9",
  "./js/app.js?v=10",
  "./js/acervo.js",
  "./js/backup.js",
  "./js/chart-pages.js",
  "./js/chords.js",
  "./js/cifra.js",
  "./js/draft.js",
  "./js/files.js",
  "./js/fixtures/cifras.js",
  "./js/forms.js",
  "./js/listen.js",
  "./js/models.js",
  "./js/pdfview.js",
  "./js/performance.js",
  "./js/source.js",
  "./js/split.js",
  "./js/store.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./vendor/pdfjs/pdf.min.mjs",
  "./vendor/pdfjs/pdf.worker.min.mjs",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      ),
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Não armazena nem intercepta chamadas de API externas ou locais
  if (url.pathname.startsWith("/api/") || event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === "basic"
          ) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Se for navegação no aplicativo e a rede falhar, retorna o app shell
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
          return new Response("Offline", {
            status: 503,
            statusText: "Service Unavailable",
          });
        });
    })
  );
});
