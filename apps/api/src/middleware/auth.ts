import { verifyApiKey } from "../db";
import type { Handler } from "../types";

function extractRaw(req: Request): string | null {
  return (
    req.headers.get("X-API-Key") ??
    req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    null
  );
}

// Protects service routes — validates against per-service SQLite keys.
// Attaches key name to request via a custom header for downstream use.
export function withServiceAuth(handler: (req: Request, source: string) => Response | Promise<Response>): Handler {
  return async (req) => {
    const raw = extractRaw(req);
    if (!raw) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const key = await verifyApiKey(raw);
    if (!key) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    return handler(req, key.name);
  };
}

// Protects admin routes — validates against ADMIN_API_KEY env var.
export function withAdminAuth(handler: Handler): Handler {
  return async (req) => {
    const adminKey = process.env["ADMIN_API_KEY"] ?? "";
    if (!adminKey) return Response.json({ ok: false, error: "Admin key not configured" }, { status: 503 });
    const raw = extractRaw(req);
    if (!raw || raw !== adminKey) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return handler(req);
  };
}
