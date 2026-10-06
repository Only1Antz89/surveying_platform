// Surveynt offline shell. Caches static assets and survey page shells only.
// API responses (survey content) are never cached here; they live in the
// app's IndexedDB store, which the user can clear from the survey screen.
const SHELL_CACHE = "surveynt-shell-v2";
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
      // Online updates must not retain an old permission UI or development CSS
      // under an unchanged asset URL. The cache remains an offline fallback.
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch {
        return (await cache.match(request)) ?? new Response("Offline asset unavailable", { status: 503 });
      }
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

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path=event.notification.data?.url;
  // Never accept an external destination from a notification payload.
  let decoded="";try{decoded=typeof path==="string"?decodeURIComponent(path):"";}catch{}
  const safe=/^\/app\/[^/?#]+\/(overview|jobs|customers|calendar|reports|properties|finance)(\?|\/|$)/.test(decoded)&&!decoded.includes("\\")&&!/(^|\/)\.{1,2}(\/|$)/.test(decoded);
  event.waitUntil(self.clients.openWindow(new URL(safe?path:"/",self.location.origin).href));
});
