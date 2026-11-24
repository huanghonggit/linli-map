// Lightweight Service Worker: cache-first for immutable bundles & 3D model chunks, network-only for /api/*.
const STATIC_CACHE = "linli-static-v2";
const MODEL_CACHE = "linli-models-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (k) =>
              k.startsWith("linli-") &&
              k !== STATIC_CACHE &&
              k !== MODEL_CACHE &&
              k !== "linli-sat-tiles-v2",
          )
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  const isImmutable =
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/cesium/");
  const isModel =
    url.pathname.startsWith("/models/v1/") ||
    url.pathname.startsWith("/media/") ||
    url.pathname.startsWith("/recognition/");

  if (!isImmutable && !isModel) return;

  const cacheName = isModel ? MODEL_CACHE : STATIC_CACHE;
  event.respondWith(
    caches.open(cacheName).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    }),
  );
});
