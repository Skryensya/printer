import type { Handler } from "../types";

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
    "Access-Control-Max-Age": "86400",
    // The allowed origin varies per request, so caches must key on it.
    "Vary": "Origin",
  };
}

// CORS_ORIGIN is a comma-separated allowlist (e.g. the deployed admin AND a
// local dev page). A browser only accepts a single, exact Access-Control-Allow-
// Origin, so we reflect back the request's Origin when it's on the list rather
// than echoing the whole list or a mismatched value.
function allowedOrigins(): string[] {
  return (process.env["CORS_ORIGIN"] ?? "http://localhost:3000")
    .split(",")
    .map(o => o.trim())
    .filter(Boolean);
}

function resolveOrigin(req: Request): string {
  const allowed = allowedOrigins();
  const reqOrigin = req.headers.get("Origin");
  if (reqOrigin && allowed.includes(reqOrigin)) return reqOrigin;
  return allowed[0] ?? "*"; // unknown origin: fall back to the primary (browser will block cross-origin)
}

export function withCors(handler: Handler): Handler {
  return async (req) => {
    const origin = resolveOrigin(req);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const res = await handler(req);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(corsHeaders(origin))) {
      headers.set(k, v);
    }
    return new Response(res.body, { status: res.status, headers });
  };
}
