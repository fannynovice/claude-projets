/* Encodage / décodage des liens privés.
 * Le contenu du lien (prénom du participant + destinataire) est placé dans le
 * fragment d'URL (#...) : il n'est jamais envoyé au serveur ni stocké nulle part.
 * Il est brouillé (XOR + sel aléatoire + base64url) pour qu'on ne puisse pas lire
 * le destinataire d'un simple coup d'œil sur le lien. Ce n'est pas un chiffrement
 * fort : il suffit à éviter de se gâcher la surprise. */
(function (global) {
  "use strict";

  function prng(seed) {
    // xorshift32
    let x = seed >>> 0 || 0x9e3779b9;
    return function () {
      x ^= x << 13; x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5; x >>>= 0;
      return x & 0xff;
    };
  }

  function seedFrom(salt) {
    return ((salt[0] << 24) | (salt[1] << 16) | (salt[2] << 8) | salt[3]) >>> 0;
  }

  function toB64url(bytes) {
    let s = "";
    bytes.forEach(function (b) { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromB64url(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function encode(obj) {
    const data = new TextEncoder().encode(JSON.stringify(obj));
    const salt = crypto.getRandomValues(new Uint8Array(4));
    const next = prng(seedFrom(salt));
    const out = new Uint8Array(4 + data.length);
    out.set(salt, 0);
    for (let i = 0; i < data.length; i++) out[4 + i] = data[i] ^ next();
    return toB64url(out);
  }

  function decode(str) {
    const raw = fromB64url(str);
    if (raw.length < 5) throw new Error("lien trop court");
    const next = prng(seedFrom(raw.subarray(0, 4)));
    const data = new Uint8Array(raw.length - 4);
    for (let i = 0; i < data.length; i++) data[i] = raw[4 + i] ^ next();
    return JSON.parse(new TextDecoder().decode(data));
  }

  /* Flocons de neige décoratifs */
  function neige(count) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = document.createElement("div");
    box.className = "neige";
    box.setAttribute("aria-hidden", "true");
    for (let i = 0; i < count; i++) {
      const f = document.createElement("span");
      f.textContent = Math.random() < 0.5 ? "❄" : "•";
      f.style.left = Math.random() * 100 + "vw";
      f.style.fontSize = (0.5 + Math.random() * 1.1) + "rem";
      f.style.opacity = (0.35 + Math.random() * 0.6).toFixed(2);
      f.style.animationDuration = (7 + Math.random() * 10) + "s";
      f.style.animationDelay = (-Math.random() * 15) + "s";
      box.appendChild(f);
    }
    document.body.appendChild(box);
  }

  global.SecretSanta = { encode: encode, decode: decode, neige: neige };
})(window);
