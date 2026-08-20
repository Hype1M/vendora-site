import { adapt } from "../lib/vercelAdapter";
import { getSupabaseAdmin, getSupabaseAnon } from "../lib/supabaseAdmin";
import { json, binary, preflight, bearer } from "../lib/http";

// Vérifie que la config serveur est présente (message clair si une variable manque).
function missingEnv(): string | null {
  const need = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const missing = need.filter((k) => !process.env[k]);
  return missing.length ? `Config serveur manquante : ${missing.join(", ")}.` : null;
}

// Le backend Render peut mettre jusqu'à ~180s (cold start + génération Gemini).
// maxDuration est fixé dans vercel.json (300s, Vercel Pro requis pour >60s).

const RENDER_API_URL =
  process.env.RENDER_API_URL || "https://gemini-api-ko4v.onrender.com";

const VALID_BACKGROUNDS = ["parquet", "solbrut", "moquette", "tapis"];
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 Mo
const GENERATION_COST = 100; // crédits par génération

// Décompte atomique côté serveur. Retourne le nouveau solde, ou null si insuffisant.
async function deduct(userId: string, amount: number): Promise<number | null> {
  const { data, error } = await getSupabaseAdmin().rpc("deduct_credits", {
    p_user: userId,
    p_amount: amount,
  });
  if (!error) return typeof data === "number" ? data : null;

  // Repli si la fonction SQL n'est pas encore créée (moins strict).
  const { data: p } = await getSupabaseAdmin()
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .maybeSingle();
  const current = p?.credits ?? 0;
  if (current < amount) return null;
  const next = current - amount;
  await getSupabaseAdmin().from("profiles").update({ credits: next }).eq("id", userId);
  return next;
}

async function post(req: Request): Promise<Response> {
  try {
    const envErr = missingEnv();
    if (envErr) return json({ error: envErr }, 500);

    // 1) Identifier l'utilisateur (token Supabase).
    const token = bearer(req);
    const {
      data: { user },
    } = await getSupabaseAnon().auth.getUser(token);
    if (!user) return json({ error: "Non connecté." }, 401);

    // 2) Valider la requête AVANT tout décompte.
    const incoming = await req.formData();
    const image = incoming.get("image1");
    const backgroundRaw = incoming.get("background");

    if (!(image instanceof File)) {
      return json({ error: "Aucune image reçue (champ 'image1' manquant)." }, 400);
    }
    if (image.size === 0) return json({ error: "Image vide." }, 400);
    if (image.size > MAX_FILE_SIZE) {
      return json({ error: "Image trop lourde (max 15 Mo)." }, 413);
    }

    const background =
      typeof backgroundRaw === "string" && VALID_BACKGROUNDS.includes(backgroundRaw)
        ? backgroundRaw
        : "parquet";

    // 3) ACCÈS : on débite 100 crédits (mode payant), ou — si solde insuffisant —
    //    un aperçu gratuit unique par compte. Au-delà → paywall (402).
    const balanceAfter = await deduct(user.id, GENERATION_COST);
    let mode: "paid" | "preview";
    if (balanceAfter !== null) {
      mode = "paid";
    } else {
      const { error: claimErr } = await getSupabaseAdmin()
        .from("free_previews")
        .insert({ user_id: user.id, path: `${user.id}.png`, locked: true });
      if (claimErr) return json({ error: "insufficient_credits" }, 402);
      mode = "preview";
    }

    // 4) Génération. En mode payant, on REMBOURSE les crédits si elle échoue.
    const forward = new FormData();
    forward.append("image1", image, image.name || "image1.png");
    forward.append("background", background);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 240_000);

    let renderRes: Response;
    try {
      renderRes = await fetch(`${RENDER_API_URL}/generate`, {
        method: "POST",
        body: forward,
        signal: controller.signal,
      });
    } catch (e: unknown) {
      if (mode === "paid") await deduct(user.id, -GENERATION_COST);
      else
        await getSupabaseAdmin().from("free_previews").delete().eq("user_id", user.id);
      const aborted = e instanceof Error && e.name === "AbortError";
      return json(
        {
          error: aborted
            ? "Le serveur met trop de temps à répondre (réessaie, il démarrait peut-être)."
            : "Impossible de contacter le serveur de génération.",
        },
        504
      );
    } finally {
      clearTimeout(timeout);
    }

    const contentType = renderRes.headers.get("content-type") || "";

    if (!renderRes.ok || !contentType.startsWith("image/")) {
      if (mode === "paid") await deduct(user.id, -GENERATION_COST);
      else
        await getSupabaseAdmin().from("free_previews").delete().eq("user_id", user.id);
      let message = "Échec de la génération.";
      try {
        const body = await renderRes.json();
        if (body?.error) message = String(body.error);
      } catch {
        /* réponse non-JSON */
      }
      return json({ error: message }, 502);
    }

    const buffer = Buffer.from(await renderRes.arrayBuffer());

    // Mode payant : on ARCHIVE la génération (image pleine, bucket privé + ligne
    // en base) pour l'historique, puis on renvoie l'image nette.
    if (mode === "paid") {
      try {
        const admin = getSupabaseAdmin();
        const genPath = `${user.id}/gen/${crypto.randomUUID()}.png`;
        const { error: upErr } = await admin.storage
          .from("previews")
          .upload(genPath, new Uint8Array(buffer), {
            contentType: contentType || "image/png",
            upsert: true,
          });
        if (!upErr) {
          await admin
            .from("generations")
            .insert({ user_id: user.id, path: genPath, background });
        }
      } catch {
        /* archivage best-effort */
      }
      return binary(new Uint8Array(buffer), contentType || "image/png", {
        "X-Credits": String(balanceAfter),
        "X-Locked": "0",
      });
    }

    // Mode APERÇU : on stocke l'image PLEINE (privée), on marque l'essai comme
    // consommé, et on ne renvoie qu'une version FLOUTÉE (débloquée au 1er paiement).
    const admin = getSupabaseAdmin();
    const path = `${user.id}.png`;
    const thumbPath = `${user.id}_thumb.jpg`;

    let blurred: Buffer;
    try {
      const sharp = (await import("sharp")).default;
      blurred = await sharp(buffer)
        .resize(720, null, { withoutEnlargement: true })
        .blur(18)
        .jpeg({ quality: 60 })
        .toBuffer();
    } catch (e: unknown) {
      // sharp indisponible → on annule la réservation d'aperçu et on remonte l'erreur.
      await getSupabaseAdmin().from("free_previews").delete().eq("user_id", user.id);
      const m = e instanceof Error ? e.message : "sharp indisponible";
      return json({ error: `Traitement image impossible : ${m}` }, 500);
    }

    await admin.storage.from("previews").upload(path, new Uint8Array(buffer), {
      contentType: contentType || "image/png",
      upsert: true,
    });
    await admin.storage
      .from("previews")
      .upload(thumbPath, new Uint8Array(blurred), {
        contentType: "image/jpeg",
        upsert: true,
      });

    return binary(new Uint8Array(blurred), "image/jpeg", { "X-Locked": "1" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erreur inconnue.";
    return json({ error: message }, 500);
  }
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method === "POST") return post(req);
  return json({ error: "Méthode non autorisée." }, 405);
}

export default adapt(handler);
