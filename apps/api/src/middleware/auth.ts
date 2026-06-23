import { verifyApiKey, type ApiKey } from "../db";
import { checkQuota, type QuotaResult } from "../ratelimit";
import { KeyPermissions } from "../permissions";
import type { Handler } from "../types";

export function extractRaw(req: Request): string | null {
  return (
    req.headers.get("X-API-Key") ??
    req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    null
  );
}

// Authenticate a request from its headers. The single place "which header holds
// the key" is decided. Returns the live (non-revoked, unexpired) key or null.
export async function authenticateKey(req: Request): Promise<ApiKey | null> {
  const raw = extractRaw(req);
  return raw ? verifyApiKey(raw) : null;
}

// ─── Response shapes ───────────────────────────────────────────────────────────
// Every auth failure body is produced here once — no copy in the call sites.

const unauthorized = (): Response => Response.json({ error: "Unauthorized" }, { status: 401 });

const forbidden = (type: string, allowed: string[] | null): Response =>
  Response.json({ error: "Job type not permitted", type, allowed }, { status: 403 });

const quotaExceeded = (quota: QuotaResult): Response =>
  new Response(
    JSON.stringify({ error: "Rate limit exceeded", exceeded: quota.exceeded, retry_after: quota.retryAfter }),
    {
      status: 429,
      headers: { ...quota.headers(), "Content-Type": "application/json", "Retry-After": String(quota.retryAfter) },
    },
  );

// ─── authorizeService — the deep auth module ──────────────────────────────────
// One pipeline: extract → verify → permit → enforce Quota. On any failure it
// returns a ready-to-send 4xx Response; on success it hands back the authorised
// Source, the custom-from grant, and the Quota State (for header attachment).
// The two service wrappers below are thin maps from this outcome to a handler.

type ServicePolicy =
  | { kind: "type"; jobType: string | null } // print/* — a single permission type
  | { kind: "message" };                      // print/message — message OR message_custom

type Authorized = { ok: true; source: string; customFromAllowed: boolean; quota: QuotaResult };
type Denied     = { ok: false; response: Response };

async function authorizeService(req: Request, policy: ServicePolicy): Promise<Authorized | Denied> {
  const key = await authenticateKey(req);
  if (!key) return { ok: false, response: unauthorized() };

  const perms = KeyPermissions.fromColumn(key.allowed_types);

  if (policy.kind === "type") {
    if (policy.jobType && !perms.permits(policy.jobType)) {
      return { ok: false, response: forbidden(policy.jobType, perms.toList()) };
    }
  } else if (!perms.permitsMessage()) {
    return { ok: false, response: forbidden("message", perms.toList()) };
  }

  const quota = await checkQuota(key);
  if (!quota.allowed) return { ok: false, response: quotaExceeded(quota) };

  return { ok: true, source: key.name, customFromAllowed: perms.allowsCustomFrom, quota };
}

// ─── Wrappers ──────────────────────────────────────────────────────────────────

// Protects service routes — per-key Quota and optional type allowlist.
export function withServiceAuth(
  jobType: string | null,
  handler: (req: Request, source: string) => Response | Promise<Response>,
): Handler {
  return async (req) => {
    const auth = await authorizeService(req, { kind: "type", jobType });
    if (!auth.ok) return auth.response;
    return auth.quota.attachHeaders(await handler(req, auth.source));
  };
}

// Protects /print/message — accepts "message" OR "message_custom"; passes
// customFromAllowed=true when the key holds message_custom (or is unrestricted).
export function withMessageAuth(
  handler: (req: Request, source: string, customFromAllowed: boolean) => Response | Promise<Response>,
): Handler {
  return async (req) => {
    const auth = await authorizeService(req, { kind: "message" });
    if (!auth.ok) return auth.response;
    return auth.quota.attachHeaders(await handler(req, auth.source, auth.customFromAllowed));
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
    if (!raw) return unauthorized();
    if (adminKey && raw === adminKey) return handler(req, null);
    const key = await verifyApiKey(raw);
    if (!key) return unauthorized();
    return handler(req, key.name);
  };
}

// Protects admin routes — validates against ADMIN_API_KEY env var.
export function withAdminAuth(handler: Handler): Handler {
  return async (req) => {
    const adminKey = process.env["ADMIN_API_KEY"] ?? "";
    if (!adminKey) return Response.json({ error: "Admin key not configured" }, { status: 503 });
    const raw = extractRaw(req);
    if (!raw || raw !== adminKey) return unauthorized();
    return handler(req);
  };
}
