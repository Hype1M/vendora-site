import Stripe from "stripe";
import { getSupabaseAdmin, getSupabaseAnon } from "../lib/supabaseAdmin";
import { json, preflight, bearer } from "../lib/http";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return _stripe;
}

// Ouvre le portail client Stripe : le client y gère/résilie son abonnement.
// La résiliation déclenche `customer.subscription.deleted` (traité par le webhook).
async function post(req: Request): Promise<Response> {
  try {
    const token = bearer(req);
    const {
      data: { user },
      error,
    } = await getSupabaseAnon().auth.getUser(token);
    if (error || !user) return json({ error: "Non connecté." }, 401);

    const { data: profile } = await getSupabaseAdmin()
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    const customerId = profile?.stripe_customer_id;
    if (!customerId) return json({ error: "Aucun abonnement à gérer." }, 400);

    const origin =
      req.headers.get("origin") || `https://${req.headers.get("host")}`;

    const portal = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/`,
    });

    return json({ url: portal.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erreur inconnue.";
    return json({ error: message }, 500);
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method === "POST") return post(req);
  return json({ error: "Méthode non autorisée." }, 405);
}
