// Helpers HTTP partagés par les fonctions serverless (/api).

export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "X-Locked, X-Credits",
  "Access-Control-Max-Age": "86400",
};

// Réponse JSON avec CORS.
export function json(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...CORS, ...extra },
  });
}

// Réponse binaire (image) avec CORS.
export function binary(
  bytes: Uint8Array,
  contentType: string,
  extra: Record<string, string> = {}
): Response {
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      ...CORS,
      ...extra,
    },
  });
}

// Réponse au préflight CORS (OPTIONS).
export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

// Extrait le token Bearer d'une requête.
export function bearer(req: Request): string {
  return (req.headers.get("authorization") || "").replace("Bearer ", "");
}

// Origine canonique du site. On n'utilise l'en-tête Host que s'il fait partie
// d'une liste blanche (sinon on retombe sur l'apex) : évite l'injection d'en-tête
// Host/Origin qui permettrait de détourner l'URL de retour après paiement.
const ALLOWED_HOSTS = new Set([
  "vendorastudio.app",
  "www.vendorastudio.app",
]);
export function siteOrigin(req: Request): string {
  const host = (req.headers.get("host") || "").toLowerCase();
  return ALLOWED_HOSTS.has(host)
    ? `https://${host}`
    : "https://vendorastudio.app";
}

// Valide un chemin de retour relatif (avec query optionnelle) : doit commencer
// par un seul "/" (pas "//" → anti open-redirect) et ne contenir que des
// caractères sûrs. Retourne un chemin propre ou le repli fourni.
export function safeReturnPath(value: unknown, fallback: string): string {
  return typeof value === "string" &&
    /^\/(?!\/)[A-Za-z0-9_\-./]*(\?[A-Za-z0-9_\-=&%.]*)?$/.test(value)
    ? value
    : fallback;
}
