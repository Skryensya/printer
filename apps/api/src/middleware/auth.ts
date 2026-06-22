import { verifyApiKey } from "../db";
import { checkQuota } from "../ratelimit";
import type { Handler } from "../types";

function extractRaw(req: Request): string | null {
  return (
    req.headers.get("X-API-Key") ??
    req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    null
  );
}

// Protects service routes — validates against per-service SQLite keys.
// Enforces per-key quota and optional type allowlist.
export function withServiceAuth(
  jobType: string | null,
  handler: (req: Request, source: string) => Response | Promise<Response>,
): Handler {
  return async (req) => {
    const raw = extractRaw(req);
    if (!raw) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const key = await verifyApiKey(raw);
    if (!key) return Response.json({ error: "Unauthorized" }, { status: 401 });

    if (jobType && key.allowed_types !== null) {
      const allowed = JSON.parse(key.allowed_types) as string[];
      if (!allowed.includes(jobType)) {
        return Response.json(
          { error: "Job type not permitted", type: jobType, allowed },
          { status: 403 },
        );
      }
    }

    const quota = await checkQuota(key);
    if (!quota.allowed) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded", exceeded: quota.exceeded, retry_after: quota.retryAfter }),
        { status: 429, headers: { ...quota.headers(), "Content-Type": "application/json", "Retry-After": String(quota.retryAfter) } },
      );
    }

    const response = await handler(req, key.name);
    return quota.attachHeaders(response);
  };
}

// Protects the /print/message endpoint. Accepts keys that have "message" OR
// "message_custom" in allowed_types. Passes customFromAllowed=true when the
// key holds the message_custom permission (or has no type restriction at all).
export function withMessageAuth(
  handler: (req: Request, source: string, customFromAllowed: boolean) => Response | Promise<Response>,
): Handler {
  return async (req) => {
    const raw = extractRaw(req);
    if (!raw) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const key = await verifyApiKey(raw);
    if (!key) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const allowed: string[] | null = key.allowed_types
      ? (JSON.parse(key.allowed_types) as string[])
      : null;

    const hasAccess =
      allowed === null ||
      allowed.includes("message") ||
      allowed.includes("message_custom");

    if (!hasAccess) {
      return Response.json(
        { error: "Job type not permitted", type: "message", allowed },
        { status: 403 },
      );
    }

    const customFromAllowed = allowed === null || allowed.includes("message_custom");

    const quota = await checkQuota(key);
    if (!quota.allowed) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded", exceeded: quota.exceeded, retry_after: quota.retryAfter }),
        { status: 429, headers: { ...quota.headers(), "Content-Type": "application/json", "Retry-After": String(quota.retryAfter) } },
      );
    }

    const response = await handler(req, key.name, customFromAllowed);
    return quota.attachHeaders(response);
  };
}

// For job reads: admin key → unrestricted; service key → source-scoped (own jobs only).
// Returns source=null for admin (no filter) or source=key.name for service keys.
export function withJobAuth(
  handler: (req: Request, source: string | null) => Response | Promise<Response>,
): Handler {
  return async (req) => {
    const adminKey = process.env["ADMIN_API_KEY"] ?? "";
    const raw = extractRaw(req);
    if (!raw) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (adminKey && raw === adminKey) return handler(req, null);
    const key = await verifyApiKey(raw);
    if (!key) return Response.json({ error: "Unauthorized" }, { status: 401 });
    return handler(req, key.name);
  };
}

// Protects admin routes — validates against ADMIN_API_KEY env var.
export function withAdminAuth(handler: Handler): Handler {
  return async (req) => {
    const adminKey = process.env["ADMIN_API_KEY"] ?? "";
    if (!adminKey) return Response.json({ error: "Admin key not configured" }, { status: 503 });
    const raw = extractRaw(req);
    if (!raw || raw !== adminKey) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handler(req);
  };
}
