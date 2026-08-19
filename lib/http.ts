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
