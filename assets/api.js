/* Accès au serveur (Supabase, fonctions RPC uniquement). */
(function (global) {
  "use strict";

  function cfg() { return global.SECRET_SANTA_CONFIG || {}; }
  function actif() { return !!(cfg().supabaseUrl && cfg().supabaseKey); }

  async function rpc(nom, params) {
    const url = (cfg().supabaseUrl || "").replace(/\/+$/, "");
    const cle = cfg().supabaseKey || "";
    const entetes = { "Content-Type": "application/json", "apikey": cle };
    if (/^eyJ/.test(cle)) entetes["Authorization"] = "Bearer " + cle; // ancienne clé « anon » (JWT)
    const r = await fetch(url + "/rest/v1/rpc/" + nom, {
      method: "POST",
      headers: entetes,
      body: JSON.stringify(params || {})
    });
    const texte = await r.text();
    let donnees = null;
    try { donnees = texte ? JSON.parse(texte) : null; } catch (e) { donnees = texte; }
    if (!r.ok) {
      const msg = donnees && donnees.message ? donnees.message : ("erreur " + r.status);
      throw new Error(msg);
    }
    return donnees;
  }

  async function sha256Hex(texte) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  function jeton() {
    const b = crypto.getRandomValues(new Uint8Array(18));
    let s = "";
    b.forEach(function (x) { s += String.fromCharCode(x); });
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /* ---------- Liens courts chiffrés ----------
   * Le lien ne contient qu'un secret aléatoire S (24 caractères).
   * id = sha256("id:" + S) (32 hex) sert d'identifiant côté serveur ;
   * clé AES-GCM = sha256("cle:" + S), qui ne quitte jamais le navigateur. */
  function b64u(bytes) {
    let s = "";
    bytes.forEach(function (x) { s += String.fromCharCode(x); });
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function deB64u(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function cleAes(secret) {
    const brut = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("cle:" + secret));
    return crypto.subtle.importKey("raw", brut, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  async function idLien(secret) { return (await sha256Hex("id:" + secret)).slice(0, 32); }

  async function preparerLien(obj) {
    const secret = jeton();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv },
      await cleAes(secret), new TextEncoder().encode(JSON.stringify(obj))));
    const tout = new Uint8Array(12 + ct.length);
    tout.set(iv, 0); tout.set(ct, 12);
    return { secret: secret, id: await idLien(secret), d: b64u(tout) };
  }

  async function ouvrirLien(secret) {
    const d = await rpc("lire_lien", { p_id: await idLien(secret) });
    if (!d) throw new Error("lien introuvable");
    const tout = deB64u(d);
    const clair = await crypto.subtle.decrypt({ name: "AES-GCM", iv: tout.subarray(0, 12) },
      await cleAes(secret), tout.subarray(12));
    return JSON.parse(new TextDecoder().decode(clair));
  }

  global.SecretSantaApi = {
    actif: actif,
    preparerLien: preparerLien,
    clePush: function () { return rpc("cle_push", {}); },
    abonnerPush: function (p) { return rpc("abonner_push", p); },
    desabonnerPush: function (endpoint, cle) { return rpc("desabonner_push", { p_endpoint: endpoint, p_cle: cle }); },
    ouvrirLien: ouvrirLien,
    creerLiens: function (liste) { return rpc("creer_liens", { p_liens: liste.map(function (l) { return { id: l.id, d: l.d }; }) }); },
    sha256Hex: sha256Hex,
    jeton: jeton,
    enregistrerSouhaits: function (cleEcriture, liste) { return rpc("enregistrer_souhaits", { p_cle: cleEcriture, p_contenu: liste }); },
    lireSouhaits: function (id) { return rpc("lire_souhaits", { p_id: id }); },
    envoyerMessage: function (canal, role, texte) { return rpc("envoyer_message", { p_canal: canal, p_role: role, p_texte: texte }); },
    lireMessages: function (canal, apres) { return rpc("lire_messages", { p_canal: canal, p_apres: apres || 0 }); }
  };
})(window);
