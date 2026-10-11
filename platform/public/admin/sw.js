/* Epsilon Admin service worker (E5).
   Offline SHELL only: precaches an offline page and the icons. Everything else goes to the network and is never
   cached: no API data, no RSC payloads, no server actions, no authenticated HTML. Also shows Web Push notifications. */
"use strict";
const SHELL = "eps-admin-shell-v1";
const PRECACHE = ["/offline.html", "/icons/icon-192.png", "/icons/badge-96.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Only full-page navigations get a fallback, and only when the network itself fails. The response is never stored.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
  }
  // anything else: the browser fetches it normally (network only)
});

function sameOriginPath(u) {
  try {
    const url = new URL(String(u || "/"), self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let p = {};
  try {
    p = event.data ? event.data.json() : {};
  } catch {
    p = {};
  }
  const title = typeof p.title === "string" && p.title ? p.title.slice(0, 120) : "Epsilon Admin";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof p.body === "string" ? p.body.slice(0, 200) : undefined,
      tag: typeof p.tag === "string" ? p.tag : undefined,
      data: { url: sameOriginPath(p.url) },
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(sameOriginPath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          return w.focus().then((f) => (f && "navigate" in f ? f.navigate(target) : f));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
