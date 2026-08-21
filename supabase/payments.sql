-- Historique des prélèvements (abonnements + recharges), alimenté par le webhook Stripe.
-- À exécuter dans l'éditeur SQL Supabase (base du projet).

create table if not exists public.payments (
  id          text primary key,          -- id de session/facture Stripe (idempotent)
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount      integer not null default 0, -- montant en centimes
  currency    text not null default 'eur',
  kind        text,                        -- 'subscription' | 'payment'
  plan        text,
  credits     integer,
  label       text,                        -- libellé lisible (Abonnement, Recharge…)
  created_at  timestamptz not null default now()
);

alter table public.payments enable row level security;

drop policy if exists "read own payments" on public.payments;
create policy "read own payments"
  on public.payments for select
  using (auth.uid() = user_id);

create index if not exists payments_user_created
  on public.payments (user_id, created_at desc);
