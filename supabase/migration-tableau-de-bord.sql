-- =====================================================================
-- Tirage persistant, lien organisateur et tableau de bord
-- (à exécuter après schema.sql)
--
-- * Un seul tirage actif. En lancer un nouveau efface l'ancien
--   (liens, listes, messages, abonnements).
-- * L'organisateur possède un secret A (dans son lien organisateur).
--   Le serveur ne reçoit que jeton = sha256("admin:" + A) et n'en garde
--   que l'empreinte. Les prénoms, photos et liens des participants sont
--   chiffrés avec une clé dérivée de A : le serveur ne peut pas les lire.
-- * Le tableau de bord montre, par participant : lien ouvert ou non et
--   liste de souhaits (modifiable), jamais le destinataire.
-- =====================================================================

create table if not exists public.evenement (
  id          int primary key default 1 check (id = 1),
  admin_hash  text not null,
  cree        timestamptz not null default now()
);
alter table public.evenement enable row level security;
revoke all on public.evenement from anon, authenticated;

create table if not exists public.participants (
  id          bigint generated always as identity primary key,
  donnees     text not null check (char_length(donnees) <= 200000),
  souhaits_id text not null check (souhaits_id ~ '^[0-9a-f]{64}$'),
  lien_id     text not null check (char_length(lien_id) = 32)
);
alter table public.participants enable row level security;
revoke all on public.participants from anon, authenticated;

-- Liens : photo du destinataire incluse, suivi des ouvertures
alter table public.liens drop constraint if exists liens_donnees_check;
alter table public.liens add constraint liens_donnees_check check (char_length(donnees) <= 200000);
alter table public.liens add column if not exists ouvert_a timestamptz;
alter table public.liens add column if not exists ouvertures int not null default 0;

-- Les liens ne se créent plus librement : uniquement via nouveau_tirage().
drop function if exists public.creer_liens(jsonb);

create or replace function public._admin_ok(p_jeton text)
returns boolean language sql security definer stable
set search_path = public, extensions
as $$ select exists (select 1 from public.evenement
                     where id = 1 and admin_hash = public._empreinte(coalesce(p_jeton, ''))) $$;
revoke all on function public._admin_ok(text) from public, anon, authenticated;

-- Un tirage existe-t-il déjà ? (pour la page organisateur)
create or replace function public.tirage_existe()
returns boolean language sql security definer stable
set search_path = public
as $$ select exists (select 1 from public.evenement where id = 1) $$;

create or replace function public.admin_verifier(p_jeton text)
returns boolean language sql security definer stable
set search_path = public, extensions
as $$ select public._admin_ok(p_jeton) $$;

-- Nouveau tirage : remplace entièrement le précédent.
-- p_liens        : [{"id": "...", "d": "..."}]
-- p_participants : [{"d": "...", "s": "<id liste>", "l": "<id lien>"}]
create or replace function public.nouveau_tirage(p_jeton text, p_liens jsonb, p_participants jsonb)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if p_jeton is null or char_length(p_jeton) <> 64 then raise exception 'jeton invalide'; end if;
  if exists (select 1 from public.evenement where id = 1) and not public._admin_ok(p_jeton) then
    raise exception 'accès organisateur requis';
  end if;
  if jsonb_typeof(p_liens) <> 'array' or jsonb_array_length(p_liens) not between 3 and 100
     or jsonb_typeof(p_participants) <> 'array'
     or jsonb_array_length(p_participants) <> jsonb_array_length(p_liens) then
    raise exception 'tirage invalide';
  end if;

  delete from public.messages    where true;
  delete from public.souhaits    where true;
  delete from public.abonnements where true;
  delete from public.participants where true;
  delete from public.liens       where true;

  insert into public.evenement (id, admin_hash) values (1, public._empreinte(p_jeton))
  on conflict (id) do update set admin_hash = excluded.admin_hash, cree = now();

  insert into public.liens (id, donnees)
  select e->>'id', e->>'d' from jsonb_array_elements(p_liens) e;

  insert into public.participants (donnees, souhaits_id, lien_id)
  select e->>'d', e->>'s', e->>'l' from jsonb_array_elements(p_participants) e;
end $$;

-- Ouverture d'un lien par un participant : renvoie le contenu chiffré et
-- note la date de première ouverture.
drop function if exists public.lire_lien(text);
create or replace function public.lire_lien(p_id text)
returns text language plpgsql security definer
set search_path = public
as $$
declare v text;
begin
  update public.liens
     set ouvert_a = coalesce(ouvert_a, now()), ouvertures = ouvertures + 1
   where id = p_id
  returning donnees into v;
  return v;
end $$;

-- Tableau de bord
create or replace function public.admin_tableau(p_jeton text)
returns table (id bigint, donnees text, souhaits_id text, souhaits jsonb, ouvert_a timestamptz, ouvertures int)
language plpgsql security definer stable
set search_path = public, extensions
as $$
begin
  if not public._admin_ok(p_jeton) then raise exception 'accès organisateur requis'; end if;
  return query
    select p.id, p.donnees, p.souhaits_id, coalesce(s.contenu, '[]'::jsonb), l.ouvert_a, coalesce(l.ouvertures, 0)
    from public.participants p
    left join public.liens l on l.id = p.lien_id
    left join public.souhaits s on s.id = p.souhaits_id
    order by p.id;
end $$;

-- Modifier la liste d'un participant (sans connaître son Père Noël)
create or replace function public.admin_enregistrer_souhaits(p_jeton text, p_souhaits_id text, p_contenu jsonb)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._admin_ok(p_jeton) then raise exception 'accès organisateur requis'; end if;
  if not exists (select 1 from public.participants where souhaits_id = p_souhaits_id) then
    raise exception 'participant inconnu';
  end if;
  if jsonb_typeof(p_contenu) <> 'array' or jsonb_array_length(p_contenu) > 30
     or octet_length(p_contenu::text) > 10000 then
    raise exception 'liste invalide';
  end if;
  insert into public.souhaits (id, contenu, maj)
  values (p_souhaits_id, p_contenu, now())
  on conflict (id) do update set contenu = excluded.contenu, maj = now();
end $$;

revoke all on function public.tirage_existe() from public;
revoke all on function public.admin_verifier(text) from public;
revoke all on function public.nouveau_tirage(text, jsonb, jsonb) from public;
revoke all on function public.lire_lien(text) from public;
revoke all on function public.admin_tableau(text) from public;
revoke all on function public.admin_enregistrer_souhaits(text, text, jsonb) from public;
grant execute on function public.tirage_existe() to anon;
grant execute on function public.admin_verifier(text) to anon;
grant execute on function public.nouveau_tirage(text, jsonb, jsonb) to anon;
grant execute on function public.lire_lien(text) to anon;
grant execute on function public.admin_tableau(text) to anon;
grant execute on function public.admin_enregistrer_souhaits(text, text, jsonb) to anon;
