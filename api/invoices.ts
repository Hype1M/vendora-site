import { adapt } from "../lib/vercelAdapter";
import { getSupabaseAdmin, getSupabaseAnon } from "../lib/supabaseAdmin";
import { json, preflight, bearer } from "../lib/http";

// Liste des prélèvements de l'utilisateur connecté (abonnements + recharges),
// pour la page Facturation. Retourne { items: [{ amount, currency, label,
// kind, plan, credits, createdAt }] }, du plus récent au plus ancien.
async function get(req: Request): Promise<Response> {
  try {
    const token = bearer(req);
    const {
      data: { user },
      error,
    } = await getSupabaseAnon().auth.getUser(token);
    if (error || !user) return json({ error: "Non connecté." }, 401);

    const { data } = await getSupabaseAdmin()
      .from("payments")
      .select("amount, currency, kind, plan, credits, label, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    const items = (data || []).map((p) => ({
      amount: p.amount,
      currency: p.currency,
      kind: p.kind,
      plan: p.plan,
      credits: p.credits,
      label: p.label,
      createdAt: p.created_at,
    }));

    return json({ items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erreur inconnue.";
    return json({ error: message }, 500);
  }
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method === "GET") return get(req);
  return json({ error: "Méthode non autorisée." }, 405);
}

export default adapt(handler);
