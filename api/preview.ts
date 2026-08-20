import { adapt } from "../lib/vercelAdapter";
import { getSupabaseAdmin, getSupabaseAnon } from "../lib/supabaseAdmin";
import { json, preflight, bearer } from "../lib/http";

// Statut de l'aperçu gratuit de l'utilisateur connecté.
// - Pas d'aperçu → { exists:false }
// - Verrouillé → { exists:true, locked:true, url: <miniature floutée signée> }
// - Débloqué (après paiement) → { exists:true, locked:false, url: <image pleine signée> }
async function get(req: Request): Promise<Response> {
  try {
    const token = bearer(req);
    const {
      data: { user },
    } = await getSupabaseAnon().auth.getUser(token);
    if (!user) return json({ error: "Non connecté." }, 401);

    const admin = getSupabaseAdmin();
    const { data: preview } = await admin
      .from("free_previews")
      .select("path, locked")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!preview) return json({ exists: false });

    const filePath = preview.locked ? `${user.id}_thumb.jpg` : (preview.path as string);
    const { data: signed } = await admin.storage
      .from("previews")
      .createSignedUrl(filePath, 60 * 60);

    return json({
      exists: true,
      locked: preview.locked,
      url: signed?.signedUrl ?? null,
    });
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
