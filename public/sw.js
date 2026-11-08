/* Pulpit Timer service worker — shell cache for installable PWA. */
const CACHE_VERSION = "pulpit-timer-v5";
const PRECACHE = [
  "/",
  "/control",
  "/display",
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/favicon.svg",
  "/css/styles.css",
  "/js/shared.js",
  "/js/control.js",
  "/js/display.js",
  "/js/pwa.js",
  "/js/icons.js",
  "/assets/brand/church-logo.png",
  "/assets/brand/church-logo-phosphor.png",
  "/assets/brand/apple-touch-icon.png",
  "/assets/brand/icon-192.png",
  "/assets/brand/icon-512.png",
  "/assets/brand/icon-512-maskable.png",
];

function isBypass(url) {
  if (url.pathname.startsWith("/socket.io")) return true;
  if (url.pathname.startsWith("/api/")) return true;
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin")) return true;
  return false;
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/css/") ||
    url.pathname.startsWith("/js/") ||
    url.pathname.startsWith("/assets/") ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/favicon.svg" ||
    url.pathname === "/manifest.webmanifest"
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await Promise.all(
        PRECACHE.map(async (path) => {
          try {
            const response = await fetch(path, { cache: "reload" });
            if (response.ok) await cache.put(path, response);
          } catch {
            /* ignore missing optional assets during install */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isBypass(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_VERSION);
    const path = new URL(request.url).pathname;
    if (response.ok && (path === "/" || path === "/control" || path === "/display")) {
      cache.put(path, response.clone());
    }
    return response;
  } catch {
    const cached =
      (await caches.match(request)) ||
      (await caches.match(new URL(request.url).pathname)) ||
      (await caches.match("/offline.html"));
    if (cached) return cached;
    return new Response("Sin conexión.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const url = new URL(request.url);
  const versioned = url.searchParams.has("v");

  // Versioned assets (?v=) prefer network so local/CSS bumps aren't stuck on stale cache.
  if (versioned) {
    try {
      const response = await fetch(request, { cache: "no-store" });
      if (response.ok) {
        await cache.put(url.pathname, response.clone());
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      const cached =
        (await cache.match(request)) || (await cache.match(url.pathname));
      if (cached) return cached;
      return new Response("", { status: 504 });
    }
  }

  const cached =
    (await cache.match(request)) || (await cache.match(url.pathname));
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
        cache.put(url.pathname, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkPromise.catch(() => {});
    return cached;
  }

  const network = await networkPromise;
  if (network) return network;
  return new Response("", { status: 504 });
}
