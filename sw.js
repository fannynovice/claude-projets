/* Service worker : affiche les notifications push du Secret Santa.
 * Le serveur n'envoie qu'un titre générique et une clé opaque ; le lien
 * privé du participant est conservé localement (Cache API) et rouvert au clic. */
"use strict";

const CACHE_LIENS = "ss-liens";

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", function (e) {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  const titre = d.titre || "🎅 Secret Santa";
  e.waitUntil(self.registration.showNotification(titre, {
    body: d.corps || "Il y a du nouveau dans ton Secret Santa.",
    icon: "assets/icone-192.png",
    badge: "assets/icone-192.png",
    tag: (d.cle || "ss") + "-" + (d.type || "info"),
    renotify: true,
    data: { cle: d.cle || "" }
  }));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  const cle = (e.notification.data && e.notification.data.cle) || "";
  e.waitUntil((async function () {
    let lien = null;
    try {
      const cache = await caches.open(CACHE_LIENS);
      const r = await cache.match("lien-" + cle);
      if (r) lien = await r.text();
    } catch (err) { /* ignore */ }
    const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const f of fenetres) {
      if (lien && f.url === lien && "focus" in f) return f.focus();
    }
    return self.clients.openWindow(lien || "./");
  })());
});
