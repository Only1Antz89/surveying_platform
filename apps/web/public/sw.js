// Surveynt offline shell. Caches static assets and survey page shells only.
// API responses (survey content) are never cached here; they live in the
// app's IndexedDB store, which the user can clear from the survey screen.
const SHELL_CACHE = "surveynt-shell-v1";
const SURVEY_PAGE = /^\/app\/[^/]+\/jobs\/[^/]+\/survey$/;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== SHELL_CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    })());
    return;
  }
  if (request.mode === "navigate" && SURVEY_PAGE.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const response = await fetch(request);
        if (response.ok && !response.redirected) cache.put(request, response.clone());
        return response;
      } catch {
        return (await cache.match(request)) ?? new Response("You are offline and this survey has not been opened on this device.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    })());
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "clear-offline-shell") event.waitUntil(caches.delete(SHELL_CACHE));
});
