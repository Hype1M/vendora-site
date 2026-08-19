import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Client Supabase côté SERVEUR uniquement (clé service_role).
// Contourne la RLS → sert à créditer/débiter les comptes et accéder au stockage.
// Instanciation paresseuse : les variables d'env ne sont lues qu'à la 1re requête.
let _admin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return _admin;
}

// Client "anon" pour valider un access token utilisateur (auth.getUser).
export function getSupabaseAnon(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
