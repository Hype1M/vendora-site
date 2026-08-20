import type { IncomingMessage, ServerResponse } from "http";

// Ce projet Vercel exécute les fonctions en signature Node classique (req, res).
// Cet adaptateur convertit (req, res) <-> l'API Web (Request/Response) pour qu'on
// garde toute la logique en handlers Web (formData, corps brut Stripe, etc.).

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export function adapt(webHandler: (req: Request) => Promise<Response>) {
  return async function (req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const method = (req.method || "GET").toUpperCase();
      const host = req.headers.host || "localhost";
      const url = `https://${host}${req.url || "/"}`;

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
        else headers.set(k, v);
      }

      let body: Buffer | undefined;
      if (method !== "GET" && method !== "HEAD") {
        const raw = await readRawBody(req);
        if (raw.length) body = raw;
      }

      const webReq = new Request(url, {
        method,
        headers,
        body: body as unknown as BodyInit | undefined,
      });

      const webRes = await webHandler(webReq);

      res.statusCode = webRes.status;
      webRes.headers.forEach((value, key) => {
        if (key.toLowerCase() === "content-length") return; // recalculé par res.end
        res.setHeader(key, value);
      });
      const out = Buffer.from(await webRes.arrayBuffer());
      res.end(out);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({ error: err instanceof Error ? err.message : "Erreur serveur" })
      );
    }
  };
}
