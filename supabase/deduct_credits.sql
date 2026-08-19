-- Vendora — Décompte atomique de crédits (1 génération = 100 crédits).
-- À coller dans Supabase → SQL Editor → Run.
--
-- Retourne le nouveau solde si le décompte a réussi,
-- ou NULL si le solde était insuffisant (rien n'est modifié).
-- Atomique : deux générations simultanées ne peuvent pas passer le solde en négatif.

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

  return new_balance; -- NULL si aucune ligne mise à jour (solde insuffisant)
end;
$$;
