/* Espace personnel : liste de souhaits + messagerie anonyme.
 * Activé seulement pour les liens v2 et si Supabase est configuré. */
(function () {
  "use strict";

  const $ = function (id) { return document.getElementById(id); };
  const Api = window.SecretSantaApi;
  let demarre = false;

  function el(tag, cls, texte) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texte != null) e.textContent = texte;
    return e;
  }

  function lienSur(u) {
    try {
      const x = new URL(u);
      return (x.protocol === "https:" || x.protocol === "http:") ? x.toString() : null;
    } catch (e) { return null; }
  }

  function memo(cle, val) {
    try {
      if (val === undefined) return localStorage.getItem(cle);
      localStorage.setItem(cle, val);
    } catch (e) { return null; }
  }

  function heure(iso) {
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  window.SecretSantaEspace = function (d) {
    if (demarre) return;
    if (!Api || !Api.actif() || d.v !== 2 || !d.w || !d.l || !d.cd || !d.cr) return;
    demarre = true;
    $("espace").hidden = false;

    /* ---------- Onglets ---------- */
    const onglets = ["liste", "sienne", "messages"];
    function choisir(nom) {
      onglets.forEach(function (o) {
        const actif = o === nom;
        $("onglet-" + o).setAttribute("aria-selected", String(actif));
        $("panneau-" + o).hidden = !actif;
      });
      if (nom === "sienne") chargerSienne();
      if (nom === "messages") { afficherFil(); marquerLu(canal); }
    }
    onglets.forEach(function (o) {
      $("onglet-" + o).addEventListener("click", function () { choisir(o); });
    });
    $("titre-sienne").textContent = "La liste de " + d.r;
    $("onglet-sienne").textContent = "🎁 Liste de " + d.r;

    /* ---------- Ma liste ---------- */
    let maListe = [];
    let monId = null;

    function rendreListe(ul, vide, liste, editable) {
      ul.innerHTML = "";
      liste.forEach(function (s, i) {
        const li = el("li");
        const corps = el("div", "souhait-corps");
        corps.appendChild(el("span", "souhait-texte", s.t));
        const u = s.u && lienSur(s.u);
        if (u) {
          const a = el("a", "souhait-lien", new URL(u).hostname.replace(/^www\./, "") + " ↗");
          a.href = u; a.target = "_blank"; a.rel = "noopener noreferrer nofollow";
          corps.appendChild(a);
        }
        li.appendChild(corps);
        if (editable) {
          const b = el("button", "retirer petit", "Retirer");
          b.type = "button";
          b.setAttribute("aria-label", "Retirer " + s.t);
          b.addEventListener("click", function () { maListe.splice(i, 1); sauverListe(); });
          li.appendChild(b);
        }
        ul.appendChild(li);
      });
      vide.hidden = liste.length > 0;
    }

    function nettoyer(liste) {
      if (!Array.isArray(liste)) return [];
      return liste.filter(function (s) { return s && typeof s.t === "string"; })
        .map(function (s) { return { t: s.t.slice(0, 120), u: typeof s.u === "string" ? s.u.slice(0, 500) : "" }; });
    }

    async function sauverListe() {
      rendreListe($("ma-liste"), $("ma-liste-vide"), maListe, true);
      $("ma-liste-etat").textContent = "Enregistrement…";
      try {
        await Api.enregistrerSouhaits(d.w, maListe);
        $("ma-liste-etat").textContent = "✅ Enregistré";
      } catch (e) {
        $("ma-liste-etat").textContent = "⚠️ Échec de l'enregistrement : " + e.message;
      }
    }

    $("form-souhait").addEventListener("submit", function (e) {
      e.preventDefault();
      const t = $("souhait-texte").value.trim();
      const u = $("souhait-lien").value.trim();
      if (!t) return;
      if (u && !lienSur(u)) { $("ma-liste-etat").textContent = "⚠️ Le lien doit commencer par https://"; return; }
      if (maListe.length >= 30) { $("ma-liste-etat").textContent = "⚠️ 30 idées maximum."; return; }
      maListe.push({ t: t, u: u });
      $("souhait-texte").value = ""; $("souhait-lien").value = "";
      sauverListe();
    });

    (async function () {
      try {
        monId = await Api.sha256Hex(d.w);
        maListe = nettoyer(await Api.lireSouhaits(monId));
        rendreListe($("ma-liste"), $("ma-liste-vide"), maListe, true);
      } catch (e) {
        $("ma-liste-etat").textContent = "⚠️ Impossible de charger ta liste : " + e.message;
      }
    })();

    /* ---------- Sa liste ---------- */
    async function chargerSienne() {
      try {
        const l = nettoyer(await Api.lireSouhaits(d.l));
        rendreListe($("sa-liste"), $("sa-liste-vide"), l, false);
      } catch (e) {
        $("sa-liste-vide").hidden = false;
        $("sa-liste-vide").textContent = "⚠️ Impossible de charger la liste : " + e.message;
      }
    }
    $("rafraichir-sienne").addEventListener("click", chargerSienne);

    /* ---------- Messages ---------- */
    // cd : je suis le Père Noël (rôle « pere ») de d.r
    // cr : je suis le destinataire (rôle « enfant ») de mon Père Noël secret
    const canaux = {
      cd: { cle: d.cd, moi: "pere", autre: d.r, msgs: [], dernier: 0 },
      cr: { cle: d.cr, moi: "enfant", autre: "🎅 Père Noël secret", msgs: [], dernier: 0 }
    };
    let canal = "cd";
    $("canal-cd").textContent = "🎁 " + d.r;

    function cleLu(nom) { return "ss-lu-" + canaux[nom].moi + "-" + canaux[nom].cle.slice(0, 10); }
    function nonLus(nom) {
      const lu = Number(memo(cleLu(nom)) || 0);
      const c = canaux[nom];
      return c.msgs.filter(function (m) { return m.id > lu && m.role !== c.moi; }).length;
    }
    function marquerLu(nom) {
      if (canaux[nom].dernier) memo(cleLu(nom), String(canaux[nom].dernier));
      majPastilles();
    }
    function majPastilles() {
      const enMessages = !$("panneau-messages").hidden;
      let total = 0;
      ["cd", "cr"].forEach(function (nom) {
        const n = (enMessages && nom === canal) ? 0 : nonLus(nom);
        total += n;
        const b = $("canal-" + nom);
        b.dataset.nonlus = n ? String(n) : "";
      });
      $("pastille").hidden = total === 0;
      $("pastille").textContent = String(total);
    }

    function afficherFil() {
      const c = canaux[canal];
      const fil = $("fil");
      const enBas = fil.scrollHeight - fil.scrollTop - fil.clientHeight < 40;
      fil.innerHTML = "";
      if (!c.msgs.length) {
        fil.appendChild(el("p", "vide", canal === "cd"
          ? "Aucun message. Pose une question à " + d.r + " : tu signeras « Père Noël secret »."
          : "Aucun message de ton Père Noël secret pour l'instant."));
      }
      c.msgs.forEach(function (m) {
        const moi = m.role === c.moi;
        const bulle = el("div", "bulle " + (moi ? "moi" : "autre"));
        bulle.appendChild(el("span", "auteur", moi ? (c.moi === "pere" ? "Moi (anonyme)" : "Moi") : c.autre));
        const t = el("p", "texte", m.texte);
        bulle.appendChild(t);
        bulle.appendChild(el("span", "quand", heure(m.cree)));
        fil.appendChild(bulle);
      });
      if (enBas || c._defile !== true) { fil.scrollTop = fil.scrollHeight; c._defile = true; }
      $("message-texte").placeholder = canal === "cd"
        ? "Message anonyme à " + d.r + "…"
        : "Message à ton Père Noël secret…";
    }

    async function charger(nom) {
      const c = canaux[nom];
      try {
        const nouveaux = await Api.lireMessages(c.cle, c.dernier);
        if (Array.isArray(nouveaux) && nouveaux.length) {
          c.msgs = c.msgs.concat(nouveaux);
          c.dernier = nouveaux[nouveaux.length - 1].id;
          if (nom === canal && !$("panneau-messages").hidden) { afficherFil(); marquerLu(nom); }
        }
        majPastilles();
      } catch (e) {
        if (nom === canal) $("message-etat").textContent = "⚠️ Connexion impossible : " + e.message;
      }
    }

    function choisirCanal(nom) {
      canal = nom;
      ["cd", "cr"].forEach(function (n) { $("canal-" + n).setAttribute("aria-pressed", String(n === nom)); });
      canaux[nom]._defile = false;
      afficherFil();
      marquerLu(nom);
    }
    $("canal-cd").addEventListener("click", function () { choisirCanal("cd"); });
    $("canal-cr").addEventListener("click", function () { choisirCanal("cr"); });

    $("form-message").addEventListener("submit", async function (e) {
      e.preventDefault();
      const champ = $("message-texte");
      const texte = champ.value.trim();
      if (!texte) return;
      const bouton = e.currentTarget.querySelector("button");
      bouton.disabled = true;
      $("message-etat").textContent = "";
      try {
        await Api.envoyerMessage(canaux[canal].cle, canaux[canal].moi, texte);
        champ.value = "";
        await charger(canal);
        canaux[canal]._defile = false;
        afficherFil();
      } catch (err) {
        $("message-etat").textContent = "⚠️ Message non envoyé : " + err.message;
      } finally {
        bouton.disabled = false;
        champ.focus();
      }
    });

    $("message-texte").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.matchMedia("(pointer: fine)").matches) {
        e.preventDefault();
        $("form-message").requestSubmit();
      }
    });

    function sonder() {
      if (document.hidden) return;
      charger("cd"); charger("cr");
    }
    sonder();
    setInterval(sonder, 8000);
    document.addEventListener("visibilitychange", sonder);

    initNotifications(d);
  };

  /* ---------- Notifications push ---------- */
  function cleVapid(b64) {
    const s = b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4);
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function initNotifications(d) {
    const bloc = $("bloc-notif"), bouton = $("notif-bouton"), texte = $("notif-texte"), etat = $("notif-etat");
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const autonome = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const possible = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;

    if (!possible) {
      bloc.hidden = false;
      bouton.hidden = true;
      if (ios && !autonome) {
        texte.textContent = "🔔 Pour recevoir des notifications sur iPhone : ouvre ce lien dans Safari, touche le bouton Partager, puis « Sur l'écran d'accueil ». Ouvre ensuite le Secret Santa depuis cette nouvelle icône : le bouton « Activer » apparaîtra ici.";
      } else if (ios) {
        texte.textContent = "🔔 Les notifications demandent iOS 16.4 ou plus récent. Mets ton iPhone à jour pour les activer.";
      } else {
        texte.textContent = "🔔 Ce navigateur ne permet pas les notifications. Ouvre ton lien dans Chrome, Edge ou Firefox (pas dans l'appli de messagerie, ni en navigation privée).";
      }
      return;
    }
    bloc.hidden = false;

    const cle = (await Api.sha256Hex("notif:" + d.w)).slice(0, 16);
    const memoire = "ss-notif-" + cle;

    async function retenirLien() {
      try {
        const cache = await caches.open("ss-liens");
        await cache.put("lien-" + cle, new Response(window.location.href));
      } catch (e) { /* ignore */ }
    }

    async function abonnementActuel() {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? reg.pushManager.getSubscription() : null;
    }

    function afficher(actif) {
      bouton.textContent = actif ? "Désactiver" : "Activer";
      bouton.classList.toggle("discret", actif);
      texte.textContent = actif
        ? "🔔 Notifications activées sur cet appareil."
        : "🔔 Sois prévenu·e des nouveaux messages et quand la liste de la personne que tu gâtes change.";
    }

    let actif = memo(memoire) === "1" && Notification.permission === "granted" && !!(await abonnementActuel());
    afficher(actif);
    if (actif) {
      retenirLien();
      // Garde le service worker à jour sur l'appareil (sans bruit).
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
        .then(function (r) { return r.update(); }).catch(function () {});
    }
    if (Notification.permission === "denied") {
      etat.textContent = "Les notifications sont bloquées pour ce site dans les réglages de ton navigateur.";
    }

    bouton.addEventListener("click", async function () {
      bouton.disabled = true;
      etat.textContent = "";
      try {
        if (actif) {
          const sub = await abonnementActuel();
          if (sub) await Api.desabonnerPush(sub.endpoint, cle);
          try { localStorage.removeItem(memoire); } catch (e) { /* ignore */ }
          actif = false;
          afficher(false);
          return;
        }
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          etat.textContent = "Notifications refusées. Tu peux les autoriser plus tard dans les réglages du navigateur.";
          return;
        }
        await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
        const reg = await navigator.serviceWorker.ready;
        const clePublique = await Api.clePush();
        if (!clePublique) throw new Error("service de notifications pas encore prêt");
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleVapid(clePublique) });
        }
        const j = sub.toJSON();
        await Api.abonnerPush({
          p_endpoint: j.endpoint,
          p_p256dh: j.keys.p256dh,
          p_auth: j.keys.auth,
          p_cle: cle,
          p_canaux: [{ s: d.cd, r: "enfant" }, { s: d.cr, r: "pere" }],
          p_listes: [d.l]
        });
        await retenirLien();
        memo(memoire, "1");
        actif = true;
        afficher(true);
      } catch (e) {
        etat.textContent = "⚠️ Impossible d'activer les notifications : " + e.message;
      } finally {
        bouton.disabled = false;
      }
    });
  }
})();
