// Fonction Edge « notifier » : envoie les notifications push.
// Appelée par les déclencheurs SQL avec { type: "message" | "liste", id },
// ou par la page (bouton de test) avec { type: "test", endpoint, cle }.
// Elle ne fait confiance qu'aux identifiants : tout le reste est relu en base,
// et chaque événement ne notifie qu'une fois (messages) ou au plus toutes
// les 10 minutes (listes de souhaits).
// À déployer avec « Verify JWT » désactivé.
import postgres from "npm:postgres@3.4.5";
import webpush from "npm:web-push@3.6.7";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2 });
const CONTACT = "https://fannynovice.github.io/claude-projets/";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

type Abonne = { endpoint: string; cle: string; p256dh: string; auth: string };

// Clés VAPID : générées une seule fois et conservées en base (jamais exposées,
// sauf la clé publique via la fonction SQL cle_push()).
let pret: Promise<void> | null = null;
async function chargerCles() {
  let [ligne] = await sql`select publique, privee from public.push_config where id = 1`;
  if (!ligne) {
    const k = webpush.generateVAPIDKeys();
    await sql`insert into public.push_config (id, publique, privee)
              values (1, ${k.publicKey}, ${sql.json({ prive: k.privateKey })})
              on conflict (id) do nothing`;
    [ligne] = await sql`select publique, privee from public.push_config where id = 1`;
  }
  // Format JWK (ancienne génération) ou chaîne base64url.
  const prive: string = ligne.privee.prive ?? ligne.privee.privateKey?.d;
  webpush.setVapidDetails(CONTACT, ligne.publique, prive);
}
function cles() {
  if (!pret) pret = chargerCles().catch((e) => { pret = null; throw e; });
  return pret;
}

async function pousser(a: Abonne, titre: string, corps: string, type: string) {
  await cles();
  return webpush.sendNotification(
    { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
    JSON.stringify({ titre, corps, cle: a.cle, type }),
    { TTL: 86400, urgency: "high" },
  );
}

function statutErreur(e: unknown): number {
  return (e as { statusCode?: number })?.statusCode ?? 0;
}

async function envoyer(sujet: string, titre: string, corps: string, type: string) {
  const abonnes = await sql<Abonne[]>`select endpoint, cle, p256dh, auth from public.abonnements
                                      where ${sujet} = any(sujets)`;
  let n = 0;
  await Promise.all(abonnes.map(async (a) => {
    try {
      await pousser(a, titre, corps, type);
      n++;
    } catch (e) {
      const statut = statutErreur(e);
      if (statut === 404 || statut === 410) {
        await sql`delete from public.abonnements where endpoint = ${a.endpoint}`;
      } else {
        console.error("échec push", statut, String(e));
      }
    }
  }));
  return n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("ok", { headers: CORS });
  let corps: { type?: string; id?: unknown; endpoint?: unknown; cle?: unknown };
  try { corps = await req.json(); } catch { return json({ erreur: "json invalide" }, 400); }

  try {
    if (corps.type === "init") {
      await cles();
      return json({ ok: true });
    }

    // Test demandé depuis la page : n'envoie qu'à l'abonnement (endpoint + cle) fourni.
    if (corps.type === "test" && typeof corps.endpoint === "string" && typeof corps.cle === "string") {
      const [a] = await sql<Abonne[]>`select endpoint, cle, p256dh, auth from public.abonnements
                                      where endpoint = ${corps.endpoint} and cle = ${corps.cle}`;
      if (!a) return json({ ok: false, erreur: "abonnement inconnu" }, 404);
      try {
        const r = await pousser(a, "🔔 Test Secret Santa", "Les notifications fonctionnent sur cet appareil !", "test");
        return json({ ok: true, statut: r.statusCode });
      } catch (e) {
        const detail = String((e as { body?: string })?.body ?? e);
        return json({ ok: false, statut: statutErreur(e), detail: detail.slice(0, 300) }, 502);
      }
    }

    if (corps.type === "message" && Number.isSafeInteger(corps.id)) {
      const [m] = await sql`update public.messages set notifie = true
                            where id = ${corps.id as number} and not notifie
                            returning canal, role`;
      if (!m) return json({ envoye: 0 });
      const titre = m.role === "pere" ? "🎅 Message de ton Père Noël secret" : "🎁 Nouveau message de la personne que tu gâtes";
      const n = await envoyer(`m:${m.canal}:${m.role}`, titre, "Ouvre ton Secret Santa pour le lire.", "message");
      return json({ envoye: n });
    }

    if (corps.type === "liste" && typeof corps.id === "string" && /^[0-9a-f]{64}$/.test(corps.id)) {
      const [l] = await sql`update public.souhaits set notifie_a = now()
                            where id = ${corps.id}
                              and (notifie_a is null or notifie_a < now() - interval '10 minutes')
                            returning id`;
      if (!l) return json({ envoye: 0 });
      const n = await envoyer(`l:${l.id}`, "📝 Liste de souhaits mise à jour",
        "La personne que tu gâtes a modifié sa liste.", "liste");
      return json({ envoye: n });
    }

    return json({ erreur: "requête invalide" }, 400);
  } catch (e) {
    console.error(e);
    return json({ erreur: "erreur", detail: String(e).slice(0, 300) }, 500);
  }
});
