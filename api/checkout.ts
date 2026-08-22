import { adapt } from "../lib/vercelAdapter";
import Stripe from "stripe";
import { getSupabaseAnon } from "../lib/supabaseAdmin";
import { STRIPE_PRODUCTS, type ProductKey } from "../lib/stripeProducts";
import { json, preflight, bearer, siteOrigin, safeReturnPath } from "../lib/http";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return _stripe;
}

async function post(req: Request): Promise<Response> {
  try {
    const { productKey, returnTo } = await req.json();
    const product = STRIPE_PRODUCTS[productKey as ProductKey];
    if (!product) return json({ error: "Produit inconnu." }, 400);

    // Page de retour après paiement (même origine). Chemin relatif validé
    // (query autorisée, pas de "//" → anti open-redirect).
    const ret = safeReturnPath(returnTo, "/pricing.html");

    // Identifier l'utilisateur via son access token Supabase.
    const token = bearer(req);
    const {
      data: { user },
      error,
    } = await getSupabaseAnon().auth.getUser(token);
    if (error || !user) return json({ error: "Non connecté." }, 401);

    const origin = siteOrigin(req);
    const sep = ret.includes("?") ? "&" : "?";

    const session = await getStripe().checkout.sessions.create({
      mode: product.mode,
      line_items: [{ price: product.priceId, quantity: 1 }],
      customer_email: user.email,
      client_reference_id: user.id,
      metadata: {
        userId: user.id,
        credits: String(product.credits),
        plan: product.plan || "",
        kind: product.mode,
      },
      ...(product.mode === "subscription"
        ? {
            subscription_data: {
              metadata: {
                userId: user.id,
                credits: String(product.credits),
                plan: product.plan || "",
              },
            },
          }
        : {}),
      success_url: `${origin}${ret}${sep}checkout=success`,
      cancel_url: `${origin}${ret}${sep}checkout=cancel`,
    });

    return json({ url: session.url });
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
