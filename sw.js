/* Service worker : affiche les notifications push du Secret Santa.
 * Le serveur n'envoie qu'un titre générique et une clé opaque ; le lien
 * privé du participant est conservé localement (Cache API) et rouvert au clic.
 * Un petit journal local (cache « ss-journal ») garde la trace de la dernière
 * notification reçue, pour le bouton de test de la page. */
"use strict";

const VERSION = "2026-11-23-1";
const CACHE_LIENS = "ss-liens";
const CACHE_JOURNAL = "ss-journal";

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

async function noter(info) {
  try {
    const c = await caches.open(CACHE_JOURNAL);
    await c.put("dernier-push", new Response(JSON.stringify(Object.assign({ quand: new Date().toISOString(), version: VERSION }, info))));
  } catch (err) { /* ignore */ }
}

self.addEventListener("push", function (e) {
  e.waitUntil((async function () {
    let d = {};
    let lecture = "ok";
    try {
      if (!e.data) lecture = "vide";
      else d = e.data.json();
    } catch (err) {
      lecture = "illisible: " + err.message;
      try { d = { corps: e.data.text() }; } catch (err2) { d = {}; }
    }
    const titre = d.titre || "🎅 Secret Santa";
    try {
      await self.registration.showNotification(titre, {
        body: d.corps || "Il y a du nouveau dans ton Secret Santa.",
        icon: "assets/icone-192.png",
        tag: (d.cle || "ss") + "-" + (d.type || "info"),
        data: { cle: d.cle || "" }
      });
      await noter({ lecture: lecture, affichage: "ok", titre: titre });
    } catch (err) {
      await noter({ lecture: lecture, affichage: "erreur: " + err.message, titre: titre });
      // Dernier recours : notification minimale.
      await self.registration.showNotification("🎅 Secret Santa", { body: "Il y a du nouveau." });
    }
  })());
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
