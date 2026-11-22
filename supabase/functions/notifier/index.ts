// Fonction Edge « notifier » : envoie les notifications push.
// Appelée par les déclencheurs SQL avec { type: "message" | "liste", id }.
// Elle ne fait confiance qu'à l'identifiant : tout le reste est relu en base,
// et chaque événement ne notifie qu'une fois (messages) ou au plus toutes
// les 10 minutes (listes de souhaits).
// À déployer avec « Verify JWT » désactivé.
import postgres from "npm:postgres@3.4.5";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2 });
const CONTACT = "https://fannynovice.github.io/claude-projets/";

let serveurPromis: Promise<webpush.ApplicationServer> | null = null;

async function chargerServeur(): Promise<webpush.ApplicationServer> {
  let [ligne] = await sql`select privee from public.push_config where id = 1`;
  if (!ligne) {
    // Première utilisation : on génère les clés VAPID, qui ne quittent jamais la base.
    const cles = await webpush.generateVapidKeys({ extractable: true });
    const exportees = await webpush.exportVapidKeys(cles);
    const publique = await webpush.exportApplicationServerKey(cles);
    await sql`insert into public.push_config (id, publique, privee)
              values (1, ${publique}, ${sql.json(exportees)})
              on conflict (id) do nothing`;
    [ligne] = await sql`select privee from public.push_config where id = 1`;
  }
  const vapidKeys = await webpush.importVapidKeys(ligne.privee, { extractable: false });
  return webpush.ApplicationServer.new({ contactInformation: CONTACT, vapidKeys });
}

function serveur() {
  if (!serveurPromis) serveurPromis = chargerServeur().catch((e) => { serveurPromis = null; throw e; });
  return serveurPromis;
}

async function envoyer(sujet: string, titre: string, corps: string, type: string) {
  const abonnes = await sql`select endpoint, cle, p256dh, auth from public.abonnements
                            where ${sujet} = any(sujets)`;
  if (!abonnes.length) return 0;
  const app = await serveur();
  let n = 0;
  await Promise.all(abonnes.map(async (a) => {
    try {
      await app.subscribe({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } })
        .pushTextMessage(JSON.stringify({ titre, corps, cle: a.cle, type }), { ttl: 86400 });
      n++;
    } catch (e) {
      const statut = e instanceof webpush.PushMessageError ? e.response.status : 0;
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
  if (req.method !== "POST") return new Response("ok");
  let corps: { type?: string; id?: unknown };
  try { corps = await req.json(); } catch { return new Response("json invalide", { status: 400 }); }

  try {
    if (corps.type === "init") {
      await serveur();
      return Response.json({ ok: true });
    }

    if (corps.type === "message" && Number.isSafeInteger(corps.id)) {
      const [m] = await sql`update public.messages set notifie = true
                            where id = ${corps.id as number} and not notifie
                            returning canal, role`;
      if (!m) return Response.json({ envoye: 0 });
      const titre = m.role === "pere" ? "🎅 Message de ton Père Noël secret" : "🎁 Nouveau message de la personne que tu gâtes";
      const n = await envoyer(`m:${m.canal}:${m.role}`, titre, "Ouvre ton Secret Santa pour le lire.", "message");
      return Response.json({ envoye: n });
    }

    if (corps.type === "liste" && typeof corps.id === "string" && /^[0-9a-f]{64}$/.test(corps.id)) {
      const [l] = await sql`update public.souhaits set notifie_a = now()
                            where id = ${corps.id}
                              and (notifie_a is null or notifie_a < now() - interval '10 minutes')
                            returning id`;
      if (!l) return Response.json({ envoye: 0 });
      const n = await envoyer(`l:${l.id}`, "📝 Liste de souhaits mise à jour",
        "La personne que tu gâtes a modifié sa liste.", "liste");
      return Response.json({ envoye: n });
    }

    return new Response("requête invalide", { status: 400 });
  } catch (e) {
    console.error(e);
    return new Response("erreur", { status: 500 });
  }
});
