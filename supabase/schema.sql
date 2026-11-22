-- =====================================================================
-- Secret Santa : listes de souhaits et messagerie anonyme
-- À exécuter une fois dans Supabase > SQL Editor.
--
-- Principe de confidentialité :
--  * Le serveur ne connaît ni les prénoms ni qui offre à qui.
--  * Chaque lien privé contient des jetons secrets aléatoires générés
--    dans le navigateur de l'organisateur. Le serveur ne stocke que
--    l'empreinte SHA-256 de ces jetons.
--  * Les tables ne sont pas accessibles directement (RLS sans politique) :
--    tout passe par les fonctions ci-dessous, qui exigent un jeton.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Listes de souhaits : id = sha256(jeton d'écriture du participant)
create table if not exists public.souhaits (
  id        text primary key,
  contenu   jsonb not null default '[]'::jsonb,
  maj       timestamptz not null default now()
);

-- Messages : canal = sha256(jeton secret partagé par un Père Noël et son destinataire)
create table if not exists public.messages (
  id     bigint generated always as identity primary key,
  canal  text not null,
  role   text not null check (role in ('pere', 'enfant')),
  texte  text not null check (char_length(texte) between 1 and 1000),
  cree   timestamptz not null default now()
);
create index if not exists messages_canal_id on public.messages (canal, id);

alter table public.souhaits enable row level security;
alter table public.messages enable row level security;
revoke all on public.souhaits from anon, authenticated;
revoke all on public.messages from anon, authenticated;

-- ---------------------------------------------------------------------
-- Empreinte hexadécimale d'un jeton
create or replace function public._empreinte(p text)
returns text language sql immutable
set search_path = public, extensions
as $$ select encode(extensions.digest(p, 'sha256'), 'hex') $$;
revoke all on function public._empreinte(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Enregistrer sa propre liste (exige le jeton d'écriture)
create or replace function public.enregistrer_souhaits(p_cle text, p_contenu jsonb)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if p_cle is null or char_length(p_cle) < 20 or char_length(p_cle) > 100 then
    raise exception 'jeton invalide';
  end if;
  if jsonb_typeof(p_contenu) <> 'array' or jsonb_array_length(p_contenu) > 30
     or octet_length(p_contenu::text) > 10000 then
    raise exception 'liste invalide';
  end if;
  insert into public.souhaits (id, contenu, maj)
  values (public._empreinte(p_cle), p_contenu, now())
  on conflict (id) do update set contenu = excluded.contenu, maj = now();
end $$;

-- Lire une liste à partir de son identifiant (empreinte)
create or replace function public.lire_souhaits(p_id text)
returns jsonb language sql security definer stable
set search_path = public
as $$ select coalesce((select contenu from public.souhaits where id = p_id), '[]'::jsonb) $$;

-- ---------------------------------------------------------------------
-- Envoyer un message dans un canal (exige le jeton secret du canal)
create or replace function public.envoyer_message(p_canal text, p_role text, p_texte text)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_canal text;
begin
  if p_canal is null or char_length(p_canal) < 20 or char_length(p_canal) > 100 then
    raise exception 'canal invalide';
  end if;
  v_canal := public._empreinte(p_canal);
  -- Anti-abus : 20 messages max par minute et par canal
  if (select count(*) from public.messages
      where canal = v_canal and cree > now() - interval '1 minute') >= 20 then
    raise exception 'trop de messages, patientez un instant';
  end if;
  insert into public.messages (canal, role, texte)
  values (v_canal, p_role, btrim(p_texte));
end $$;

-- Lire les messages d'un canal (exige le jeton secret du canal)
create or replace function public.lire_messages(p_canal text, p_apres bigint default 0)
returns table (id bigint, role text, texte text, cree timestamptz)
language sql security definer stable
set search_path = public, extensions
as $$
  select m.id, m.role, m.texte, m.cree
  from public.messages m
  where m.canal = public._empreinte(p_canal) and m.id > coalesce(p_apres, 0)
  order by m.id
  limit 300
$$;

revoke all on function public.enregistrer_souhaits(text, jsonb) from public;
revoke all on function public.lire_souhaits(text) from public;
revoke all on function public.envoyer_message(text, text, text) from public;
revoke all on function public.lire_messages(text, bigint) from public;
grant execute on function public.enregistrer_souhaits(text, jsonb) to anon;
grant execute on function public.lire_souhaits(text) to anon;
grant execute on function public.envoyer_message(text, text, text) to anon;
grant execute on function public.lire_messages(text, bigint) to anon;

-- ---------------------------------------------------------------------
-- Liens courts : le contenu du lien est chiffré (AES-GCM) dans le navigateur
-- de l'organisateur. La clé ne quitte jamais le lien ; le serveur ne stocke
-- qu'un identifiant dérivé et un bloc illisible.
create table if not exists public.liens (
  id      text primary key check (char_length(id) = 32),
  donnees text not null check (char_length(donnees) <= 4000),
  cree    timestamptz not null default now()
);
alter table public.liens enable row level security;
revoke all on public.liens from anon, authenticated;

create or replace function public.creer_liens(p_liens jsonb)
returns void language plpgsql security definer
set search_path = public
as $$
begin
  if jsonb_typeof(p_liens) <> 'array' or jsonb_array_length(p_liens) > 100 then
    raise exception 'liste de liens invalide';
  end if;
  insert into public.liens (id, donnees)
  select e->>'id', e->>'d' from jsonb_array_elements(p_liens) e;
end $$;

create or replace function public.lire_lien(p_id text)
returns text language sql security definer stable
set search_path = public
as $$ select donnees from public.liens where id = p_id $$;

revoke all on function public.creer_liens(jsonb) from public;
revoke all on function public.lire_lien(text) from public;
grant execute on function public.creer_liens(jsonb) to anon;
grant execute on function public.lire_lien(text) to anon;

-- ---------------------------------------------------------------------
-- Ménage après les fêtes (à lancer à la main quand vous voulez) :
-- delete from public.messages where cree < now() - interval '90 days';
-- delete from public.souhaits where maj  < now() - interval '90 days';
-- delete from public.liens    where cree < now() - interval '90 days';
