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

  global.SecretSantaApi = {
    actif: actif,
    sha256Hex: sha256Hex,
    jeton: jeton,
    enregistrerSouhaits: function (cleEcriture, liste) { return rpc("enregistrer_souhaits", { p_cle: cleEcriture, p_contenu: liste }); },
    lireSouhaits: function (id) { return rpc("lire_souhaits", { p_id: id }); },
    envoyerMessage: function (canal, role, texte) { return rpc("envoyer_message", { p_canal: canal, p_role: role, p_texte: texte }); },
    lireMessages: function (canal, apres) { return rpc("lire_messages", { p_canal: canal, p_apres: apres || 0 }); }
  };
})(window);
