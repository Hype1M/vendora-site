// Mapping des produits Stripe (mode Test).
// Le nombre de crédits accordé est décidé ICI (côté serveur) — jamais par le
// client — donc impossible de tricher depuis le navigateur.

export type ProductKey =
  | "discovery_monthly"
  | "discovery_annual"
  | "essential_monthly"
  | "essential_annual"
  | "ultimate_monthly"
  | "ultimate_annual"
  | "topup_800"
  | "topup_2000";

export const STRIPE_PRODUCTS: Record<
  ProductKey,
  {
    priceId: string;
    mode: "subscription" | "payment";
    credits: number;
    plan?: string;
  }
> = {
  discovery_monthly: {
    priceId: "price_1TsTJKH7ST5spAqh5DiVA7CD", // 9,90 €/mois
    mode: "subscription",
    credits: 2000,
    plan: "discovery",
  },
  discovery_annual: {
    priceId: "price_1TsTJkH7ST5spAqh17SfZDQj", // 94,80 €/an
    mode: "subscription",
    credits: 2000,
    plan: "discovery",
  },
  essential_monthly: {
    priceId: "price_1TsTDtH7ST5spAqh4xF9vcVf", // 19,90 €/mois
    mode: "subscription",
    credits: 5000,
    plan: "essential",
  },
  essential_annual: {
    priceId: "price_1TsTEeH7ST5spAqhPdL4GtuP", // 202,80 €/an
    mode: "subscription",
    credits: 5000,
    plan: "essential",
  },
  ultimate_monthly: {
    priceId: "price_1TsTFZH7ST5spAqhlr1oBQKg", // 39,90 €/mois
    mode: "subscription",
    credits: 1000000,
    plan: "ultimate",
  },
  ultimate_annual: {
    priceId: "price_1TsTFzH7ST5spAqhNPqRssZ7", // 406,80 €/an
    mode: "subscription",
    credits: 1000000,
    plan: "ultimate",
  },
  topup_800: {
    priceId: "price_1TsMJtH7ST5spAqhG3b7bqlt", // 9,90 € (unique) · 800 crédits
    mode: "payment",
    credits: 800,
  },
  topup_2000: {
    priceId: "price_1TsMJwH7ST5spAqhW601r8eH", // 19,90 € (unique) · 2000 crédits
    mode: "payment",
    credits: 2000,
  },
};
