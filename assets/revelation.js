(async function () {
  "use strict";

  const contenu = document.getElementById("contenu");
  window.addEventListener("hashchange", function () { window.location.reload(); });

  function el(tag, cls, texte) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texte != null) e.textContent = texte;
    return e;
  }

  function erreur() {
    contenu.innerHTML = "";
    contenu.appendChild(el("p", "titre-fete", "Oups… 🎄"));
    contenu.appendChild(el("p", null, "Ce lien est incomplet ou invalide. Vérifie que tu as bien copié le lien en entier, ou demande-le à nouveau à l'organisateur."));
  }

  function dateFr(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return iso;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }

  // Ouvert depuis l'écran d'accueil sans le « #… » : on reprend le dernier lien de cet appareil,
  // sinon on propose de le coller.
  let brut = window.location.hash.replace(/^#/, "");
  if (!brut) {
    try { brut = localStorage.getItem("ss-dernier-lien") || ""; } catch (e) { brut = ""; }
    if (brut) { history.replaceState(null, "", "#" + brut); }
  }
  if (!brut) {
    contenu.innerHTML = "";
    contenu.appendChild(el("p", "titre-fete", "Ton Secret Santa 🎄"));
    contenu.appendChild(el("p", "aide", "Colle ici le lien personnel que tu as reçu :"));
    const f = el("form", "ligne");
    const champ = el("input");
    champ.type = "text"; champ.placeholder = "https://…/voir.html#…"; champ.setAttribute("aria-label", "Ton lien personnel");
    const ok = el("button", null, "Ouvrir"); ok.type = "submit";
    f.appendChild(champ); f.appendChild(ok);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      const v = champ.value.trim();
      const s = v.indexOf("#") >= 0 ? v.slice(v.indexOf("#") + 1) : v;
      if (s) window.location.hash = s;
    });
    contenu.appendChild(f);
    SecretSanta.neige(20);
    return;
  }
  let donnees;
  try {
    // Lien court (secret seul, contenu chiffré sur le serveur) ou lien long (contenu codé dans le lien)
    if (brut.length <= 40) {
      if (!window.SecretSantaApi || !SecretSantaApi.actif()) throw new Error("serveur non configuré");
      donnees = await SecretSantaApi.ouvrirLien(brut);
    } else {
      donnees = SecretSanta.decode(brut);
    }
    if (!donnees || typeof donnees.d !== "string" || typeof donnees.r !== "string") throw new Error("format");
  } catch (e) {
    erreur();
    SecretSanta.neige(20);
    return;
  }

  try { localStorage.setItem("ss-dernier-lien", brut); } catch (e) { /* ignore */ }
  if (donnees.t) document.title = donnees.t + " – Secret Santa";

  contenu.innerHTML = "";
  contenu.appendChild(el("p", "bonjour", "Bonjour " + donnees.d + " ! 👋"));
  contenu.appendChild(el("p", "titre-fete", donnees.t || "Ton Secret Santa"));

  const intro = el("p", "aide", "Touche le cadeau pour découvrir à qui tu vas offrir un cadeau. Assure-toi que personne ne regarde ton écran !");
  contenu.appendChild(intro);

  const cadeau = el("button", "cadeau");
  cadeau.type = "button";
  cadeau.setAttribute("aria-label", "Ouvrir le cadeau pour découvrir ton destinataire");
  cadeau.appendChild(el("span", "boite"));
  cadeau.appendChild(el("span", "couvercle"));
  cadeau.appendChild(el("span", "ruban-v"));
  const noeud = el("span", "noeud", "🎀");
  noeud.setAttribute("aria-hidden", "true");
  cadeau.appendChild(noeud);
  contenu.appendChild(cadeau);

  const zone = el("div", "destinataire");
  zone.setAttribute("aria-live", "polite");
  zone.appendChild(el("p", null, "Tu offres un cadeau à…"));
  if (typeof donnees.p === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(donnees.p)) {
    const photo = el("img", "photo-destinataire");
    photo.src = donnees.p;
    photo.alt = "Photo de " + donnees.r;
    zone.appendChild(photo);
  }
  zone.appendChild(el("p", "nom-destinataire", donnees.r));
  zone.appendChild(el("p", "aide", "Chut ! C'est un secret. 🤫"));

  const infos = el("div", "infos");
  if (donnees.b) {
    const d = el("div"); d.appendChild(el("strong", null, "Budget")); d.appendChild(document.createTextNode(donnees.b)); infos.appendChild(d);
  }
  if (donnees.j) {
    const d = el("div"); d.appendChild(el("strong", null, "Date de l'échange")); d.appendChild(document.createTextNode(dateFr(donnees.j))); infos.appendChild(d);
  }
  if (donnees.m) {
    const d = el("div"); d.appendChild(el("strong", null, "Le mot de l'organisateur"));
    const p = el("span", null, donnees.m); p.style.whiteSpace = "pre-line"; d.appendChild(p); infos.appendChild(d);
  }
  if (infos.childNodes.length) zone.appendChild(infos);

  const masquer = el("button", "discret petit", "🙈 Masquer");
  masquer.type = "button";
  masquer.style.marginTop = "16px";
  zone.appendChild(masquer);
  contenu.appendChild(zone);

  function ouvrir() {
    cadeau.classList.add("ouvert");
    intro.hidden = true;
    setTimeout(function () {
      cadeau.hidden = true;
      zone.classList.add("visible");
      if (window.SecretSantaEspace) window.SecretSantaEspace(donnees);
    }, 550);
  }

  cadeau.addEventListener("click", ouvrir);
  masquer.addEventListener("click", function () {
    zone.classList.remove("visible");
    cadeau.classList.remove("ouvert");
    cadeau.hidden = false;
    intro.hidden = false;
  });

  SecretSanta.neige(28);
})();
