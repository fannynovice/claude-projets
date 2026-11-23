(function () {
  "use strict";

  const CLE_BROUILLON = "secret-santa-brouillon-v1";
  const CLE_ADMIN = "ss-admin";
  const $ = function (id) { return document.getElementById(id); };
  const Api = window.SecretSantaApi;
  const enLigne = !!(Api && Api.actif());

  // Brouillon : la configuration seulement (jamais le résultat du tirage).
  const etat = {
    participants: [],          // ["Alice", "Bob", ...]
    exclusions: [],            // [["Alice", "Bob"], ...]  => Alice n'offre pas à Bob
    photos: {}                 // { "Alice": "data:image/jpeg;base64,..." }
  };

  let admin = null;            // secret organisateur (présent dans le lien organisateur)
  let tirageExiste = false;
  let liensCourants = [];

  /* ---------- Brouillon local (confort uniquement) ---------- */
  function sauver() {
    const d = {
      participants: etat.participants,
      exclusions: etat.exclusions,
      photos: etat.photos,
      titre: $("titre").value,
      budget: $("budget").value,
      date: $("date").value,
      mot: $("mot").value
    };
    try { localStorage.setItem(CLE_BROUILLON, JSON.stringify(d)); }
    catch (e) {
      // Stockage plein (photos) : on garde au moins le reste.
      try { d.photos = {}; localStorage.setItem(CLE_BROUILLON, JSON.stringify(d)); } catch (e2) { /* ignore */ }
    }
  }

  function charger() {
    try {
      const d = JSON.parse(localStorage.getItem(CLE_BROUILLON) || "null");
      if (!d) return;
      etat.participants = Array.isArray(d.participants) ? d.participants.filter(function (p) { return typeof p === "string"; }) : [];
      etat.exclusions = Array.isArray(d.exclusions) ? d.exclusions.filter(function (x) {
        return Array.isArray(x) && etat.participants.indexOf(x[0]) >= 0 && etat.participants.indexOf(x[1]) >= 0;
      }) : [];
      etat.photos = {};
      if (d.photos && typeof d.photos === "object") {
        Object.keys(d.photos).forEach(function (n) {
          if (etat.participants.indexOf(n) >= 0 && photoValide(d.photos[n])) etat.photos[n] = d.photos[n];
        });
      }
      $("titre").value = d.titre || "";
      $("budget").value = d.budget || "";
      $("date").value = d.date || "";
      $("mot").value = d.mot || "";
    } catch (e) { /* ignore */ }
  }

  function memoAdmin(a) {
    try { if (a) localStorage.setItem(CLE_ADMIN, a); else localStorage.removeItem(CLE_ADMIN); } catch (e) { /* ignore */ }
  }

  /* ---------- Participants ---------- */
  function normaliser(nom) { return nom.trim().replace(/\s+/g, " "); }
  function existe(nom) {
    const n = nom.toLocaleLowerCase("fr");
    return etat.participants.some(function (p) { return p.toLocaleLowerCase("fr") === n; });
  }

  function ajouterParticipants(texte) {
    const noms = texte.split(/[,;\n]+/).map(normaliser).filter(Boolean);
    const doublons = [];
    noms.forEach(function (nom) {
      if (existe(nom)) doublons.push(nom); else etat.participants.push(nom);
    });
    if (doublons.length) afficherMessage("Déjà dans la liste : " + doublons.join(", "), "erreur");
    else effacerMessage();
    rendre();
  }

  function retirerParticipant(nom) {
    etat.participants = etat.participants.filter(function (p) { return p !== nom; });
    etat.exclusions = etat.exclusions.filter(function (x) { return x[0] !== nom && x[1] !== nom; });
    delete etat.photos[nom];
    rendre();
  }

  /* ---------- Photos ---------- */
  function photoValide(p) { return typeof p === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p) && p.length < 120000; }

  // Recadre au carré et réduit à 256 px (JPEG) pour garder des liens légers.
  function reduirePhoto(fichier) {
    return new Promise(function (ok, ko) {
      const url = URL.createObjectURL(fichier);
      const img = new Image();
      img.onload = function () {
        const cote = Math.min(img.naturalWidth, img.naturalHeight);
        const taille = Math.min(256, cote);
        const c = document.createElement("canvas");
        c.width = c.height = taille;
        c.getContext("2d").drawImage(img, (img.naturalWidth - cote) / 2, (img.naturalHeight - cote) / 2, cote, cote, 0, 0, taille, taille);
        URL.revokeObjectURL(url);
        let q = 0.8, data = c.toDataURL("image/jpeg", q);
        while (data.length > 40000 && q > 0.35) { q -= 0.1; data = c.toDataURL("image/jpeg", q); }
        ok(data);
      };
      img.onerror = function () { URL.revokeObjectURL(url); ko(new Error("image illisible")); };
      img.src = url;
    });
  }

  let photoPour = null;
  function choisirPhoto(nom) { photoPour = nom; $("photo-fichier").value = ""; $("photo-fichier").click(); }

  $("photo-fichier").addEventListener("change", async function () {
    const f = this.files && this.files[0];
    if (!f || !photoPour) return;
    try {
      etat.photos[photoPour] = await reduirePhoto(f);
      effacerMessage();
    } catch (e) {
      afficherMessage("Impossible de lire cette image : " + e.message, "erreur");
    }
    photoPour = null;
    rendre();
  });

  /* ---------- Exclusions ---------- */
  function aExclusion(a, b) {
    return etat.exclusions.some(function (x) { return x[0] === a && x[1] === b; });
  }

  function ajouterExclusion(a, b, reciproque) {
    if (!a || !b) return;
    if (a === b) { afficherMessage("Choisissez deux personnes différentes.", "erreur"); return; }
    if (!aExclusion(a, b)) etat.exclusions.push([a, b]);
    if (reciproque && !aExclusion(b, a)) etat.exclusions.push([b, a]);
    effacerMessage();
    rendre();
  }

  function retirerExclusion(a, b) {
    etat.exclusions = etat.exclusions.filter(function (x) { return !(x[0] === a && x[1] === b); });
    rendre();
  }

  /* ---------- Tirage ---------- */
  function aleatoire(n) {
    const max = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    let x;
    do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= max);
    return x % n;
  }

  function melanger(t) {
    const a = t.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = aleatoire(i + 1);
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  /* Renvoie un tableau cible[i] = indice du destinataire de i, ou null si impossible. */
  function tirage(noms, exclusions) {
    const n = noms.length;
    const interdit = noms.map(function () { return new Set(); });
    exclusions.forEach(function (x) {
      const i = noms.indexOf(x[0]), j = noms.indexOf(x[1]);
      if (i >= 0 && j >= 0) interdit[i].add(j);
    });
    const options = noms.map(function (_, i) {
      const o = [];
      for (let j = 0; j < n; j++) if (j !== i && !interdit[i].has(j)) o.push(j);
      return o;
    });
    if (options.some(function (o) { return o.length === 0; })) return null;

    const ordre = melanger(noms.map(function (_, i) { return i; }))
      .sort(function (a, b) { return options[a].length - options[b].length; });

    const cible = new Array(n).fill(-1);
    const pris = new Array(n).fill(false);
    let essais = 0;

    function placer(k) {
      if (k === n) return true;
      if (++essais > 200000) return false;
      const i = ordre[k];
      const cands = melanger(options[i]);
      for (let c = 0; c < cands.length; c++) {
        const j = cands[c];
        if (pris[j]) continue;
        pris[j] = true; cible[i] = j;
        if (placer(k + 1)) return true;
        pris[j] = false; cible[i] = -1;
      }
      return false;
    }

    return placer(0) ? cible : null;
  }

  function urlPage(nom) {
    const u = new URL(nom, window.location.href);
    u.search = ""; u.hash = "";
    return u.toString();
  }
  function lienAdmin() { return urlPage("./") + "#admin=" + admin; }

  async function lancerTirage() {
    effacerMessage();
    const noms = etat.participants.slice();
    if (noms.length < 3) {
      afficherMessage("Il faut au moins 3 participants pour un Secret Santa.", "erreur");
      return;
    }
    if (enLigne && tirageExiste && !admin) {
      afficherMessage("Un tirage existe déjà : ouvrez votre lien organisateur pour le remplacer.", "erreur");
      return;
    }
    if (enLigne && tirageExiste && !confirm("Ce nouveau tirage va effacer le tirage actuel (liens, listes de souhaits, messages). Continuer ?")) return;

    const resultat = tirage(noms, etat.exclusions);
    if (!resultat) {
      afficherMessage("Impossible de trouver un tirage qui respecte toutes les exclusions. Retirez-en quelques-unes et réessayez.", "erreur");
      return;
    }
    const base = urlPage("voir.html");
    const infos = { t: $("titre").value.trim(), b: $("budget").value.trim(), j: $("date").value, m: $("mot").value.trim() };

    // Jetons secrets : w[i] écrit la liste de i ; c[i] = canal entre i (Père Noël) et son destinataire.
    let w = [], c = [], idListe = [], pere = [];
    if (enLigne) {
      w = noms.map(function () { return Api.jeton(); });
      c = noms.map(function () { return Api.jeton(); });
      idListe = await Promise.all(w.map(Api.sha256Hex));
      resultat.forEach(function (j, i) { pere[j] = i; });
    }
    const charges = noms.map(function (nom, i) {
      const dest = noms[resultat[i]];
      const charge = { v: enLigne ? 2 : 1, d: nom, r: dest };
      Object.keys(infos).forEach(function (k) { if (infos[k]) charge[k] = infos[k]; });
      if (enLigne) {
        charge.w = w[i];
        charge.l = idListe[resultat[i]];
        charge.cd = c[i];
        charge.cr = c[pere[i]];
        if (etat.photos[dest]) charge.p = etat.photos[dest];   // photo de la personne à gâter
      }
      return charge;
    });

    const bouton = $("tirer");
    bouton.disabled = true;
    bouton.textContent = "⏳ Tirage en cours…";
    try {
      if (enLigne) {
        const a = admin || Api.jeton();
        const prepares = await Promise.all(charges.map(Api.preparerLien));
        const urls = prepares.map(function (p) { return base + "#" + p.secret; });
        const fiches = await Promise.all(noms.map(async function (nom, i) {
          const fiche = { nom: nom, lien: urls[i] };
          if (etat.photos[nom]) fiche.photo = etat.photos[nom];
          return { d: await Api.chiffrerFiche(a, fiche), s: idListe[i], l: prepares[i].id };
        }));
        await Api.nouveauTirage(a, prepares, fiches);
        admin = a;
        memoAdmin(a);
        tirageExiste = true;
        liensCourants = noms.map(function (nom, i) { return { nom: nom, url: urls[i] }; });
      } else {
        liensCourants = noms.map(function (nom, i) { return { nom: nom, url: base + "#" + SecretSanta.encode(charges[i]) }; });
      }
    } catch (e) {
      afficherMessage("Le tirage n'a pas pu être enregistré : " + e.message, "erreur");
      return;
    } finally {
      bouton.disabled = false;
      bouton.textContent = "🎲 Lancer le tirage";
    }
    rendreResultats();
    afficherMessage("🎉 Tirage réussi ! Les liens sont prêts à être envoyés.", "ok");
    if (enLigne) { afficherModeAdmin(); chargerTableau(); }
    $("bloc-resultats").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- Partage ---------- */
  function texteInvitation(l) {
    const titre = $("titre").value.trim() || "Secret Santa";
    return "🎅 " + titre + " – Bonjour " + l.nom + " ! Découvre à qui tu offres un cadeau (lien personnel, ne le partage pas) : " + l.url;
  }

  function copier(texte, bouton) {
    function ok() {
      const ancien = bouton.textContent;
      bouton.textContent = "✅ Copié";
      setTimeout(function () { bouton.textContent = ancien; }, 1500);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(texte).then(ok, function () { copieSecours(texte); ok(); });
    } else { copieSecours(texte); ok(); }
  }

  function copieSecours(texte) {
    const t = document.createElement("textarea");
    t.value = texte;
    t.setAttribute("readonly", "");
    t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    try { document.execCommand("copy"); } catch (e) { /* ignore */ }
    document.body.removeChild(t);
  }

  function actionsPartage(l) {
    const msg = texteInvitation(l);
    const peutPartager = typeof navigator.share === "function";
    return [
      el("button", { type: "button", class: "petit", texte: "📋 Copier le lien", onclick: function (ev) { copier(l.url, ev.currentTarget); } }),
      peutPartager ? el("button", { type: "button", class: "petit discret", texte: "📤 Partager",
        onclick: function () { navigator.share({ title: "Secret Santa", text: msg }).catch(function () {}); } }) : null,
      el("a", { class: "bouton petit discret", href: "https://wa.me/?text=" + encodeURIComponent(msg), target: "_blank", rel: "noopener noreferrer", texte: "WhatsApp" }),
      el("a", { class: "bouton petit discret", href: "sms:?&body=" + encodeURIComponent(msg), texte: "SMS" }),
      el("a", { class: "bouton petit discret", href: "mailto:?subject=" + encodeURIComponent("🎅 Ton Secret Santa") + "&body=" + encodeURIComponent(msg), texte: "E-mail" })
    ];
  }

  /* ---------- Rendu ---------- */
  function el(tag, props, enfants) {
    const e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === "texte") e.textContent = props[k];
      else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), props[k]);
      else e.setAttribute(k, props[k]);
    });
    (enfants || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function vignette(photo, nom, cls) {
    if (photoValide(photo)) {
      const i = el("img", { class: cls || "vignette", alt: "Photo de " + nom });
      i.src = photo;
      return i;
    }
    return el("span", { class: (cls || "vignette") + " sans-photo", "aria-hidden": "true", texte: (nom || "?").charAt(0).toUpperCase() });
  }

  function rendre() {
    const ul = $("liste-participants");
    ul.innerHTML = "";
    etat.participants.forEach(function (nom) {
      const aPhoto = !!etat.photos[nom];
      ul.appendChild(el("li", { class: "puce" }, [
        aPhoto ? vignette(etat.photos[nom], nom, "puce-photo") : null,
        el("span", { texte: nom }),
        el("button", { type: "button", class: "puce-action", "aria-label": (aPhoto ? "Changer la photo de " : "Ajouter une photo pour ") + nom,
          title: aPhoto ? "Changer la photo" : "Ajouter une photo", texte: "📷", onclick: function () { choisirPhoto(nom); } }),
        aPhoto ? el("button", { type: "button", class: "puce-action", "aria-label": "Retirer la photo de " + nom, title: "Retirer la photo", texte: "🚫",
          onclick: function () { delete etat.photos[nom]; rendre(); } }) : null,
        el("button", { type: "button", "aria-label": "Retirer " + nom, title: "Retirer", texte: "×",
          onclick: function () { retirerParticipant(nom); } })
      ]));
    });
    $("aucun-participant").hidden = etat.participants.length > 0;

    ["excl-de", "excl-a"].forEach(function (id, idx) {
      const s = $(id);
      const avant = s.value;
      s.innerHTML = "";
      s.appendChild(el("option", { value: "", texte: idx === 0 ? "Qui offre…" : "…à qui" }));
      etat.participants.forEach(function (nom) { s.appendChild(el("option", { value: nom, texte: nom })); });
      if (etat.participants.indexOf(avant) >= 0) s.value = avant;
      s.disabled = etat.participants.length < 2;
    });

    const ue = $("liste-exclusions");
    ue.innerHTML = "";
    etat.exclusions.forEach(function (x) {
      ue.appendChild(el("li", null, [
        el("span", { texte: x[0] + " ✗ " + x[1] }),
        el("button", { type: "button", class: "retirer petit", "aria-label": "Retirer l'exclusion " + x[0] + " vers " + x[1], texte: "Retirer",
          onclick: function () { retirerExclusion(x[0], x[1]); } })
      ]));
    });
    $("aucune-exclusion").hidden = etat.exclusions.length > 0;

    sauver();
  }

  function rendreResultats() {
    const ul = $("resultats");
    ul.innerHTML = "";
    liensCourants.forEach(function (l) {
      ul.appendChild(el("li", null, [
        el("div", { class: "nom" }, [el("span", { texte: "🎁 Lien de " + l.nom })]),
        el("div", { class: "lien", texte: l.url }),
        el("div", { class: "actions" }, actionsPartage(l))
      ]));
    });
    $("bloc-lien-admin").hidden = !admin;
    if (admin) $("lien-admin").textContent = lienAdmin();
    $("bloc-resultats").hidden = false;
  }

  function afficherMessage(texte, type, cible) {
    const m = $(cible || "message");
    m.className = "message " + type;
    m.textContent = texte;
  }
  function effacerMessage(cible) { const m = $(cible || "message"); m.className = ""; m.textContent = ""; }

  /* ---------- Tableau de bord ---------- */
  function dateFr(iso) {
    return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function lienSur(u) {
    try { const x = new URL(u); return (x.protocol === "https:" || x.protocol === "http:") ? x.toString() : null; }
    catch (e) { return null; }
  }

  function nettoyerListe(liste) {
    if (!Array.isArray(liste)) return [];
    return liste.filter(function (s) { return s && typeof s.t === "string"; })
      .map(function (s) { return { t: s.t.slice(0, 120), u: typeof s.u === "string" ? s.u.slice(0, 500) : "" }; });
  }

  function editeurListe(p) {
    const boite = el("details", { class: "liste-admin" });
    const resume = el("summary");
    const ul = el("ul", { class: "souhaits" });
    const etatTxt = el("p", { class: "etat", role: "status" });

    function majResume() { resume.textContent = "📝 Liste de souhaits (" + p.liste.length + ")"; }

    async function enregistrer() {
      etatTxt.textContent = "Enregistrement…";
      try {
        await Api.adminEnregistrerSouhaits(admin, p.souhaits_id, p.liste);
        etatTxt.textContent = "✅ Enregistré";
      } catch (e) {
        etatTxt.textContent = "⚠️ " + e.message;
      }
    }

    function rendreItems() {
      ul.innerHTML = "";
      p.liste.forEach(function (s, i) {
        const corps = el("div", { class: "souhait-corps" }, [el("span", { class: "souhait-texte", texte: s.t })]);
        const u = s.u && lienSur(s.u);
        if (u) corps.appendChild(el("a", { class: "souhait-lien", href: u, target: "_blank", rel: "noopener noreferrer nofollow", texte: new URL(u).hostname.replace(/^www\./, "") + " ↗" }));
        ul.appendChild(el("li", null, [corps, el("button", { type: "button", class: "retirer petit", texte: "Retirer",
          "aria-label": "Retirer " + s.t, onclick: function () { p.liste.splice(i, 1); rendreItems(); enregistrer(); } })]));
      });
      if (!p.liste.length) ul.appendChild(el("li", { class: "vide-liste" }, [el("span", { class: "vide", texte: "Liste vide." })]));
      majResume();
    }

    const champT = el("input", { type: "text", maxlength: "120", placeholder: "Ajouter une idée", "aria-label": "Idée de cadeau pour " + p.nom });
    const champU = el("input", { type: "text", maxlength: "500", placeholder: "Lien (facultatif)", inputmode: "url", "aria-label": "Lien de l'idée" });
    const form = el("form", { class: "ajout-admin" }, [champT, champU, el("button", { type: "submit", class: "petit", texte: "Ajouter" })]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const t = champT.value.trim(), u = champU.value.trim();
      if (!t) return;
      if (u && !lienSur(u)) { etatTxt.textContent = "⚠️ Le lien doit commencer par https://"; return; }
      if (p.liste.length >= 30) { etatTxt.textContent = "⚠️ 30 idées maximum."; return; }
      p.liste.push({ t: t, u: u });
      champT.value = ""; champU.value = "";
      rendreItems();
      enregistrer();
    });

    boite.appendChild(resume);
    boite.appendChild(ul);
    boite.appendChild(form);
    boite.appendChild(etatTxt);
    rendreItems();
    return boite;
  }

  async function chargerTableau() {
    if (!admin) return;
    const ul = $("tableau");
    effacerMessage("tableau-message");
    let lignes;
    try {
      lignes = await Api.adminTableau(admin);
    } catch (e) {
      afficherMessage("Impossible de charger le tableau de bord : " + e.message, "erreur", "tableau-message");
      return;
    }
    const personnes = await Promise.all((lignes || []).map(async function (r) {
      let f = {};
      try { f = await Api.dechiffrerFiche(admin, r.donnees); } catch (e) { f = { nom: "(illisible)" }; }
      return { nom: f.nom || "?", lien: f.lien || "", photo: f.photo, souhaits_id: r.souhaits_id,
        liste: nettoyerListe(r.souhaits), ouvert_a: r.ouvert_a, ouvertures: r.ouvertures };
    }));
    personnes.sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); });

    const ouverts = personnes.filter(function (p) { return p.ouvert_a; }).length;
    $("tableau-resume").textContent = personnes.length
      ? "🔓 " + ouverts + " lien" + (ouverts > 1 ? "s" : "") + " ouvert" + (ouverts > 1 ? "s" : "") + " sur " + personnes.length
      : "Aucun participant.";

    ul.innerHTML = "";
    personnes.forEach(function (p) {
      const statut = p.ouvert_a
        ? el("span", { class: "statut ouvert", texte: "✅ Ouvert le " + dateFr(p.ouvert_a) })
        : el("span", { class: "statut ferme", texte: "⏳ Pas encore ouvert" });
      const entete = el("div", { class: "tableau-entete" }, [
        vignette(p.photo, p.nom),
        el("div", { class: "tableau-nom" }, [el("strong", { texte: p.nom }), statut])
      ]);
      const actions = el("div", { class: "actions" }, [
        el("button", { type: "button", class: "petit discret", texte: "📋 Copier son lien", onclick: function (ev) { copier(p.lien, ev.currentTarget); } }),
        el("a", { class: "bouton petit discret", href: "https://wa.me/?text=" + encodeURIComponent(texteInvitation(p)), target: "_blank", rel: "noopener noreferrer", texte: "Renvoyer par WhatsApp" })
      ]);
      ul.appendChild(el("li", null, [entete, editeurListe(p), actions]));
    });
  }

  function afficherModeAdmin() {
    $("bloc-tableau").hidden = false;
    $("bloc-acces").hidden = true;
    $("formulaire").hidden = true;
    $("avert-remplacement").hidden = false;
  }

  /* ---------- Événements ---------- */
  $("form-participant").addEventListener("submit", function (e) {
    e.preventDefault();
    const champ = $("nouveau");
    if (!champ.value.trim()) return;
    ajouterParticipants(champ.value);
    champ.value = "";
    champ.focus();
  });

  $("nouveau").addEventListener("paste", function (e) {
    const t = (e.clipboardData || window.clipboardData).getData("text");
    if (/[,;\n]/.test(t)) {
      e.preventDefault();
      ajouterParticipants(t);
    }
  });

  $("form-exclusion").addEventListener("submit", function (e) {
    e.preventDefault();
    ajouterExclusion($("excl-de").value, $("excl-a").value, $("excl-reciproque").checked);
  });

  ["titre", "budget", "date", "mot"].forEach(function (id) {
    $(id).addEventListener("input", sauver);
  });

  $("tirer").addEventListener("click", lancerTirage);

  $("tout-copier").addEventListener("click", function (e) {
    copier(liensCourants.map(function (l) { return l.nom + " : " + l.url; }).join("\n"), e.currentTarget);
  });

  $("copier-lien-admin").addEventListener("click", function (e) { copier(lienAdmin(), e.currentTarget); });
  $("copier-lien-admin-2").addEventListener("click", function (e) { copier(lienAdmin(), e.currentTarget); });
  $("tableau-rafraichir").addEventListener("click", chargerTableau);
  $("nouveau-tirage").addEventListener("click", function () {
    $("formulaire").hidden = false;
    $("formulaire").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("form-acces").addEventListener("submit", async function (e) {
    e.preventDefault();
    const v = $("acces-lien").value.trim();
    const m = /admin=([A-Za-z0-9_-]{20,})/.exec(v);
    const a = m ? m[1] : (/^[A-Za-z0-9_-]{20,}$/.test(v) ? v : null);
    if (!a) { afficherMessage("Ce n'est pas un lien organisateur.", "erreur", "acces-message"); return; }
    try {
      if (!(await Api.adminVerifier(a))) throw new Error("lien organisateur incorrect");
      admin = a; memoAdmin(a);
      effacerMessage("acces-message");
      afficherModeAdmin();
      chargerTableau();
    } catch (err) {
      afficherMessage("Accès refusé : " + err.message, "erreur", "acces-message");
    }
  });

  $("reinitialiser").addEventListener("click", function () {
    if (!confirm("Effacer le brouillon (participants, photos, exclusions et informations) de cet appareil ?")) return;
    etat.participants = []; etat.exclusions = []; etat.photos = {};
    ["titre", "budget", "date", "mot"].forEach(function (id) { $(id).value = ""; });
    effacerMessage(); rendre();
    try { localStorage.removeItem(CLE_BROUILLON); } catch (e) { /* ignore */ }
  });

  window.__tirage = tirage;

  /* ---------- Démarrage ---------- */
  async function demarrer() {
    charger();
    rendre();
    SecretSanta.neige(28);
    if (!enLigne) { $("bloc-chargement").hidden = true; return; }

    $("formulaire").hidden = true;
    let a = null;
    const m = /admin=([A-Za-z0-9_-]{20,})/.exec(window.location.hash);
    if (m) {
      a = m[1];
      history.replaceState(null, "", window.location.pathname + window.location.search);
    } else {
      try { a = localStorage.getItem(CLE_ADMIN); } catch (e) { a = null; }
    }
    try {
      tirageExiste = await Api.tirageExiste();
      if (a && tirageExiste && await Api.adminVerifier(a)) {
        admin = a; memoAdmin(a);
      } else if (a && tirageExiste) {
        memoAdmin(null);
      }
    } catch (e) {
      $("bloc-chargement").hidden = true;
      $("formulaire").hidden = false;
      afficherMessage("Serveur injoignable : " + e.message, "erreur");
      return;
    }
    $("bloc-chargement").hidden = true;
    if (admin) { afficherModeAdmin(); chargerTableau(); }
    else if (tirageExiste) { $("bloc-acces").hidden = false; }
    else { $("formulaire").hidden = false; }
  }

  demarrer();
})();
