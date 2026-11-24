// Two-level satellite tile cache: in-memory LRU + persistent Cache API + request deduplication.
const CACHE_NAME = "linli-sat-tiles-v2";
const MAX_MEM_TILES = 280;

const memCache = new Map();
const inFlight = new Map();

function remember(url, blob) {
  if (memCache.has(url)) memCache.delete(url);
  memCache.set(url, blob);
  while (memCache.size > MAX_MEM_TILES) {
    const oldest = memCache.keys().next().value;
    memCache.delete(oldest);
  }
}

async function openPersistentCache() {
  try {
    if (typeof caches !== "undefined") return await caches.open(CACHE_NAME);
  } catch {
    /* private mode or restricted webview */
  }
  return null;
}

const cachePromise = openPersistentCache();

async function fetchSingle(url, signal) {
  const res = await fetch(url, { signal, priority: "low" });
  if (!res.ok) throw Error(`影像瓦片请求失败 (${res.status})`);
  const blob = await res.blob();
  if (!blob.size || (blob.type && !blob.type.startsWith("image/"))) {
    throw Error("影像瓦片内容无效");
  }
  remember(url, blob);
  cachePromise
    .then((cache) => {
      if (!cache) return;
      return cache.put(
        url,
        new Response(blob, {
          headers: { "Content-Type": blob.type || "image/jpeg" },
        }),
      );
    })
    .catch(() => {});
  return blob;
}

export async function loadTileBitmap(urls, signal) {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [urls].filter(Boolean);
  for (const url of list) {
    if (memCache.has(url)) {
      const blob = memCache.get(url);
      remember(url, blob);
      return createImageBitmap(blob);
    }
  }
  const cache = await cachePromise;
  if (cache) {
    for (const url of list) {
      try {
        const hit = await cache.match(url);
        if (hit) {
          const blob = await hit.blob();
          if (blob.size > 0) {
            remember(url, blob);
            return createImageBitmap(blob);
          }
        }
      } catch {
        /* ignore cache read error */
      }
    }
  }
  let lastError = null;
  for (const url of list) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      let pending = inFlight.get(url);
      if (!pending) {
        pending = fetchSingle(url, signal).finally(() => inFlight.delete(url));
        inFlight.set(url, pending);
      }
      const blob = await pending;
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return await createImageBitmap(blob);
    } catch (err) {
      if (signal?.aborted || err?.name === "AbortError") throw err;
      lastError = err;
    }
  }
  throw lastError || Error("影像瓦片未返回");
}

export function tileCacheStats() {
  return { memoryEntries: memCache.size, maxMemoryEntries: MAX_MEM_TILES };
}
