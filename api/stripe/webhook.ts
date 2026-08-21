import { adapt } from "../../lib/vercelAdapter";
import Stripe from "stripe";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return _stripe;
}

// Ajoute des crédits au solde (atomique via RPC, avec repli lecture+écriture).
async function addCredits(userId: string, amount: number) {
  const { error } = await getSupabaseAdmin().rpc("deduct_credits", {
    p_user: userId,
    p_amount: -amount, // -amount => ajoute
  });
  if (error) {
    const { data } = await getSupabaseAdmin()
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .maybeSingle();
    await getSupabaseAdmin()
      .from("profiles")
      .update({ credits: (data?.credits ?? 0) + amount })
      .eq("id", userId);
  }
}

async function post(req: Request): Promise<Response> {
  // Corps BRUT (indispensable pour vérifier la signature).
  const body = await req.text();
  const sig = req.headers.get("stripe-signature") || "";

  // 1) Vérification de signature : refuse tout ce qui ne vient pas de Stripe.
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || ""
    );
  } catch (err: unknown) {
    const m = err instanceof Error ? err.message : "invalid";
    return new Response(`Webhook signature error: ${m}`, { status: 400 });
  }

  // 2) Idempotence : chaque événement n'est traité qu'UNE fois.
  const { error: dupErr } = await getSupabaseAdmin()
    .from("stripe_events")
    .insert({ id: event.id, type: event.type });
  if (dupErr) {
    if (dupErr.code === "23505") {
      return new Response(
        JSON.stringify({ received: true, duplicate: true }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    // Autre erreur (table pas encore créée) → on continue quand même.
  }

  try {
    switch (event.type) {
      // --- Paiement initial (abonnement OU recharge) ---
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const credits = parseInt(session.metadata?.credits || "0", 10);
        const plan = session.metadata?.plan || null;
        const kind = session.metadata?.kind;
        if (!userId || credits <= 0) break;

        if (kind === "subscription") {
          await getSupabaseAdmin()
            .from("profiles")
            .update({
              credits,
              plan,
              stripe_customer_id:
                typeof session.customer === "string" ? session.customer : null,
            })
            .eq("id", userId);
        } else {
          await addCredits(userId, credits); // recharge → ajoute au solde
        }

        // Débloque l'aperçu gratuit (s'il existe) : le paiement est effectué.
        await getSupabaseAdmin()
          .from("free_previews")
          .update({ locked: false })
          .eq("user_id", userId);

        // Trace le prélèvement pour la page Facturation (best-effort).
        await getSupabaseAdmin()
          .from("payments")
          .upsert(
            {
              id: session.id,
              user_id: userId,
              amount: session.amount_total ?? 0,
              currency: session.currency ?? "eur",
              kind,
              plan,
              credits,
              label:
                kind === "subscription"
                  ? "Abonnement"
                  : "Recharge de crédits",
            },
            { onConflict: "id" }
          );
        break;
      }

      // --- Renouvellement mensuel/annuel d'un abonnement ---
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice & {
          subscription?: string;
          billing_reason?: string;
        };
        if (invoice.billing_reason !== "subscription_cycle") break;
        if (!invoice.subscription) break;

        const sub = await getStripe().subscriptions.retrieve(invoice.subscription);
        const userId = sub.metadata?.userId;
        const credits = parseInt(sub.metadata?.credits || "0", 10);
        const plan = sub.metadata?.plan || null;
        if (userId && credits > 0) {
          await getSupabaseAdmin()
            .from("profiles")
            .update({ credits, plan })
            .eq("id", userId);
          // Trace le renouvellement dans la Facturation (best-effort).
          await getSupabaseAdmin()
            .from("payments")
            .upsert(
              {
                id: invoice.id,
                user_id: userId,
                amount: (invoice as unknown as { amount_paid?: number }).amount_paid ?? 0,
                currency: (invoice as unknown as { currency?: string }).currency ?? "eur",
                kind: "subscription",
                plan,
                credits,
                label: "Renouvellement",
              },
              { onConflict: "id" }
            );
        }
        break;
      }

      // --- Résiliation (fin d'abonnement) ---
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        if (userId) {
          await getSupabaseAdmin()
            .from("profiles")
            .update({ plan: "free", credits: 0 })
            .eq("id", userId);
        }
        break;
      }

      default:
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err: unknown) {
    // Échec de traitement → on retire la trace pour que Stripe réessaie.
    await getSupabaseAdmin().from("stripe_events").delete().eq("id", event.id);
    const m = err instanceof Error ? err.message : "processing error";
    return new Response(`Webhook processing error: ${m}`, { status: 500 });
  }
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "POST") return post(req);
  return new Response("Méthode non autorisée.", { status: 405 });
}

export default adapt(handler);
