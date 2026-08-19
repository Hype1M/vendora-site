-- =====================================================================
-- Vendora — Setup complet Supabase (sécurisé). Idempotent : ré-exécutable.
-- À coller dans Supabase → SQL Editor → Run.
-- =====================================================================

-- 1) PROFILS -----------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  credits integer not null default 0,
  plan text default 'free',
  stripe_customer_id text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- Lecture : chaque user ne voit que son profil. (Aucune policy INSERT/UPDATE
-- côté client : les crédits ne changent QUE via le service_role, côté serveur.)
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Création auto du profil à l'inscription (0 crédit).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, credits)
  values (new.id, new.email, 0)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) DÉCOMPTE ATOMIQUE DE CRÉDITS -------------------------------------
-- Retourne le nouveau solde, ou NULL si insuffisant (rien modifié).
-- Empêche tout solde négatif même en cas de requêtes simultanées.
create or replace function public.deduct_credits(p_user uuid, p_amount int)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  new_balance int;
begin
  update public.profiles
     set credits = credits - p_amount
   where id = p_user
     and credits >= p_amount
  returning credits into new_balance;
  return new_balance;
end;
$$;

-- 3) IDEMPOTENCE DES WEBHOOKS STRIPE ----------------------------------
-- Stripe peut renvoyer plusieurs fois le même événement : on garde une
-- trace pour ne JAMAIS créditer deux fois le même paiement.
create table if not exists public.stripe_events (
  id text primary key,
  type text,
  created_at timestamptz default now()
);
alter table public.stripe_events enable row level security;
-- (aucune policy → inaccessible au client ; seul le service_role y accède)

-- 4) VERROUILLAGE DES FONCTIONS ---------------------------------------
-- CRITIQUE : par défaut Postgres accorde EXECUTE à "public" (donc aux rôles
-- anon/authenticated), et Supabase expose ces fonctions en RPC. Comme elles
-- sont SECURITY DEFINER (elles ignorent la RLS), un utilisateur pourrait sinon
-- appeler deduct_credits depuis le navigateur avec un montant NÉGATIF et
-- s'auto-créditer à l'infini. On retire donc l'accès à tout le monde et on ne
-- le rend qu'au service_role (utilisé UNIQUEMENT côté serveur).
revoke all on function public.deduct_credits(uuid, int)
  from public, anon, authenticated;
grant execute on function public.deduct_credits(uuid, int) to service_role;

revoke all on function public.handle_new_user()
  from public, anon, authenticated;
-- (handle_new_user reste déclenchée par le trigger d'inscription : le trigger
--  n'a pas besoin du droit EXECUTE, il s'exécute avec les droits du définisseur.)

-- 5) APERÇU GRATUIT (1 par compte) ------------------------------------
-- 1re génération sans crédits → image générée + stockée, rendue floutée, puis
-- débloquée au 1er paiement. Une ligne par utilisateur = 1 essai gratuit max.
create table if not exists public.free_previews (
  user_id uuid primary key references auth.users(id) on delete cascade,
  path text not null,
  locked boolean not null default true,
  created_at timestamptz default now()
);
alter table public.free_previews enable row level security;
-- (aucune policy → inaccessible au client ; seul le service_role y accède,
--  via les routes serveur /api/generate, /api/preview et le webhook Stripe.)

-- Bucket de stockage PRIVÉ pour l'image d'aperçu (pleine résolution). Le client
-- n'y accède jamais directement : le serveur génère une URL signée au déblocage.
insert into storage.buckets (id, name, public)
values ('previews', 'previews', false)
on conflict (id) do nothing;

-- 6) HISTORIQUE DES GÉNÉRATIONS PAYANTES ------------------------------
-- Chaque génération réussie en mode payant est archivée : l'image pleine
-- résolution est stockée dans le bucket privé `previews` (sous
-- `${user_id}/gen/${id}.png`) et une ligne est insérée ici. Permet de
-- retrouver son historique après un rechargement / une reconnexion.
create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  path text not null,
  background text,
  created_at timestamptz default now()
);
create index if not exists generations_user_created_idx
  on public.generations (user_id, created_at desc);
alter table public.generations enable row level security;
-- (aucune policy → inaccessible au client ; seul le service_role y accède via
--  les routes serveur /api/generate et /api/generations.)
