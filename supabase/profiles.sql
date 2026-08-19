-- Vendora — Table des profils utilisateurs (solde de crédits, abonnement).
-- À coller dans Supabase → SQL Editor → Run.

-- 1. Table des profils (1 ligne par utilisateur)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  credits integer not null default 0,
  plan text default 'free',
  stripe_customer_id text,
  created_at timestamptz default now()
);

-- 2. Sécurité : chaque user ne peut LIRE que son propre profil
alter table public.profiles enable row level security;

create policy "read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- (pas de policy UPDATE : les crédits ne se modifient que côté serveur,
--  via le webhook Stripe — impossible à tricher depuis le navigateur)

-- 3. Créer automatiquement le profil à l'inscription (0 crédit)
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, credits)
  values (new.id, new.email, 0);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
