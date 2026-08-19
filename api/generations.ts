import { getSupabaseAdmin, getSupabaseAnon } from "../lib/supabaseAdmin";
import { json, preflight, bearer } from "../lib/http";

// Historique des générations payantes de l'utilisateur connecté.
// Retourne { items: [{ url, background, createdAt }] } avec `url` = URL signée
// temporaire vers l'image pleine résolution du bucket privé.
async function get(req: Request): Promise<Response> {
  try {
    const token = bearer(req);
    const {
      data: { user },
    } = await getSupabaseAnon().auth.getUser(token);
    if (!user) return json({ error: "Non connecté." }, 401);

    const admin = getSupabaseAdmin();
    const { data: rows } = await admin
      .from("generations")
      .select("path, background, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    const items = await Promise.all(
      (rows ?? []).map(async (r) => {
        const { data: signed } = await admin.storage
          .from("previews")
          .createSignedUrl(r.path as string, 60 * 60);
        return signed?.signedUrl
          ? {
              url: signed.signedUrl,
              background: r.background as string | null,
              createdAt: r.created_at as string,
            }
          : null;
      })
    );

    return json({ items: items.filter(Boolean) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erreur inconnue.";
    return json({ error: message }, 500);
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method === "GET") return get(req);
  return json({ error: "Méthode non autorisée." }, 405);
}
