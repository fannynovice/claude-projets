(function () {
  "use strict";

  const CLE_BROUILLON = "secret-santa-brouillon-v1";
  const $ = function (id) { return document.getElementById(id); };

  // État : uniquement la configuration. Les résultats du tirage ne sont jamais sauvegardés.
  const etat = {
    participants: [],          // ["Alice", "Bob", ...]
    exclusions: []             // [["Alice", "Bob"], ...]  => Alice n'offre pas à Bob
  };

  /* ---------- Brouillon local (confort uniquement) ---------- */
  function sauver() {
    try {
      localStorage.setItem(CLE_BROUILLON, JSON.stringify({
        participants: etat.participants,
        exclusions: etat.exclusions,
        titre: $("titre").value,
        budget: $("budget").value,
        date: $("date").value,
        mot: $("mot").value
      }));
    } catch (e) { /* stockage indisponible : sans importance */ }
  }

  function charger() {
    try {
      const d = JSON.parse(localStorage.getItem(CLE_BROUILLON) || "null");
      if (!d) return;
      etat.participants = Array.isArray(d.participants) ? d.participants.filter(function (p) { return typeof p === "string"; }) : [];
      etat.exclusions = Array.isArray(d.exclusions) ? d.exclusions.filter(function (x) {
        return Array.isArray(x) && etat.participants.indexOf(x[0]) >= 0 && etat.participants.indexOf(x[1]) >= 0;
      }) : [];
      $("titre").value = d.titre || "";
      $("budget").value = d.budget || "";
      $("date").value = d.date || "";
      $("mot").value = d.mot || "";
    } catch (e) { /* ignore */ }
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
    invaliderTirage();
    rendre();
  }

  function retirerParticipant(nom) {
    etat.participants = etat.participants.filter(function (p) { return p !== nom; });
    etat.exclusions = etat.exclusions.filter(function (x) { return x[0] !== nom && x[1] !== nom; });
    invaliderTirage();
    rendre();
  }

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
    invaliderTirage();
    rendre();
  }

  function retirerExclusion(a, b) {
    etat.exclusions = etat.exclusions.filter(function (x) { return !(x[0] === a && x[1] === b); });
    invaliderTirage();
    rendre();
  }

  /* ---------- Tirage ---------- */
  function aleatoire(n) {
    // Entier uniforme dans [0, n) via crypto
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

    // Ordre : les plus contraints d'abord (ex æquo départagés au hasard)
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

  function urlRevelation() {
    const u = new URL("voir.html", window.location.href);
    u.search = ""; u.hash = "";
    return u.toString();
  }

  let liensCourants = [];

  function lancerTirage() {
    effacerMessage();
    const noms = etat.participants.slice();
    if (noms.length < 3) {
      afficherMessage("Il faut au moins 3 participants pour un Secret Santa.", "erreur");
      return;
    }
    const resultat = tirage(noms, etat.exclusions);
    if (!resultat) {
      afficherMessage("Impossible de trouver un tirage qui respecte toutes les exclusions. Retirez-en quelques-unes et réessayez.", "erreur");
      $("bloc-resultats").hidden = true;
      return;
    }
    const base = urlRevelation();
    const infos = {
      t: $("titre").value.trim(),
      b: $("budget").value.trim(),
      j: $("date").value,
      m: $("mot").value.trim()
    };
    liensCourants = noms.map(function (nom, i) {
      const charge = { v: 1, d: nom, r: noms[resultat[i]] };
      Object.keys(infos).forEach(function (k) { if (infos[k]) charge[k] = infos[k]; });
      return { nom: nom, url: base + "#" + SecretSanta.encode(charge) };
    });
    rendreResultats();
    afficherMessage("🎉 Tirage réussi ! Voici les liens privés à envoyer.", "ok");
    $("bloc-resultats").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function invaliderTirage() {
    if (liensCourants.length) {
      liensCourants = [];
      $("bloc-resultats").hidden = true;
      $("resultats").innerHTML = "";
    }
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

  function rendre() {
    // Participants
    const ul = $("liste-participants");
    ul.innerHTML = "";
    etat.participants.forEach(function (nom) {
      ul.appendChild(el("li", { class: "puce" }, [
        el("span", { texte: nom }),
        el("button", { type: "button", "aria-label": "Retirer " + nom, title: "Retirer", texte: "×",
          onclick: function () { retirerParticipant(nom); } })
      ]));
    });
    $("aucun-participant").hidden = etat.participants.length > 0;

    // Sélecteurs d'exclusion
    ["excl-de", "excl-a"].forEach(function (id, idx) {
      const s = $(id);
      const avant = s.value;
      s.innerHTML = "";
      s.appendChild(el("option", { value: "", texte: idx === 0 ? "Qui offre…" : "…à qui" }));
      etat.participants.forEach(function (nom) { s.appendChild(el("option", { value: nom, texte: nom })); });
      if (etat.participants.indexOf(avant) >= 0) s.value = avant;
      s.disabled = etat.participants.length < 2;
    });

    // Exclusions
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
    const peutPartager = typeof navigator.share === "function";
    liensCourants.forEach(function (l) {
      const msg = texteInvitation(l);
      const actions = [
        el("button", { type: "button", class: "petit", texte: "📋 Copier", onclick: function (ev) { copier(msg, ev.currentTarget); } }),
        peutPartager ? el("button", { type: "button", class: "petit discret", texte: "📤 Partager",
          onclick: function () { navigator.share({ title: "Secret Santa", text: msg }).catch(function () {}); } }) : null,
        el("a", { class: "bouton petit discret", href: "https://wa.me/?text=" + encodeURIComponent(msg), target: "_blank", rel: "noopener noreferrer", texte: "WhatsApp" }),
        el("a", { class: "bouton petit discret", href: "sms:?&body=" + encodeURIComponent(msg), texte: "SMS" }),
        el("a", { class: "bouton petit discret", href: "mailto:?subject=" + encodeURIComponent("🎅 Ton Secret Santa") + "&body=" + encodeURIComponent(msg), texte: "E-mail" })
      ];
      ul.appendChild(el("li", null, [
        el("div", { class: "nom" }, [el("span", { texte: "🎁 Lien de " + l.nom })]),
        el("div", { class: "lien", texte: l.url }),
        el("div", { class: "actions" }, actions)
      ]));
    });
    $("bloc-resultats").hidden = false;
  }

  function afficherMessage(texte, type) {
    const m = $("message");
    m.className = "message " + type;
    m.textContent = texte;
  }
  function effacerMessage() { const m = $("message"); m.className = ""; m.textContent = ""; }

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
    $(id).addEventListener("input", function () { invaliderTirage(); sauver(); });
  });

  $("tirer").addEventListener("click", lancerTirage);

  $("tout-copier").addEventListener("click", function (e) {
    copier(liensCourants.map(function (l) { return l.nom + " : " + l.url; }).join("\n"), e.currentTarget);
  });

  $("reinitialiser").addEventListener("click", function () {
    if (!confirm("Effacer tous les participants, exclusions et informations ?")) return;
    etat.participants = []; etat.exclusions = [];
    ["titre", "budget", "date", "mot"].forEach(function (id) { $(id).value = ""; });
    invaliderTirage(); effacerMessage(); rendre();
    try { localStorage.removeItem(CLE_BROUILLON); } catch (e) { /* ignore */ }
  });

  // Exposé pour les tests manuels dans la console
  window.__tirage = tirage;

  charger();
  rendre();
  SecretSanta.neige(28);
})();
