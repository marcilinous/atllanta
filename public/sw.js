const CACHE_NAME = "atllanta-1.4.0";
// App Router routes (app/): never cached by this worker, see the fetch handler.
const NETWORK_ONLY_PREFIXES = ["/settings", "/session", "/auth", "/health"];
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/login.html",
  "/css/tokens.css",
  "/css/base.css",
  "/css/layout.css",
  "/css/components.css",
  "/manifest.json",
  "/icon-192.svg",
  "/icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  // New-stack (Next.js App Router) pages are per-user and server-rendered on
  // every request, and router.refresh() re-fetches them as RSC payloads. A
  // cached copy would redraw stale settings after a change, or show the
  // previous user's page on a shared browser — so the worker stays out of
  // the way entirely and the browser goes straight to the network.
  const { pathname } = new URL(request.url);
  if (
    NETWORK_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    (request.headers && request.headers.get("RSC"))
  ) {
    return;
  }

  // The release version must always come from the network; a cached copy
  // would show users the previous version after a release.
  if (new URL(request.url).pathname === "/version.json") {
    event.respondWith(
      fetch(request).catch(() =>
        new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } })
      )
    );
    return;
  }

  if (request.url.includes("/api/") || request.url.includes("supabase")) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: "Offline" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
