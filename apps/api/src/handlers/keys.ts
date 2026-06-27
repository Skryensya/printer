import { createApiKey, listApiKeys, revokeApiKey, deleteApiKey, updateApiKey, listKeyStats } from "../db";
import { PERMISSION_TYPES, KeyPermissions } from "../permissions";
import { authenticateKey } from "../middleware/auth";

function err(msg: string, status = 400): Response {
  return Response.json({ error: msg }, { status });
}

// expires_at is Unix seconds. A value at/before now would mint a key that's
// dead on arrival — every later request just reports it "expired", with no clue
// that it was born that way. Reject it loudly at the source instead.
function pastExpiry(expiresAt: number | null | undefined): boolean {
  return expiresAt != null && expiresAt <= Math.floor(Date.now() / 1000);
}

export async function listKeysHandler(_req: Request): Promise<Response> {
  return Response.json({ keys: await listApiKeys() });
}

// Per-key lifetime usage counters (enqueued / printed / failed).
export async function getKeyStatsHandler(_req: Request): Promise<Response> {
  return Response.json({ stats: await listKeyStats() });
}

const VALID_TYPES = new Set<string>(PERMISSION_TYPES);

export async function createKeyHandler(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null) as {
    name?: string;
    expires_at?: number;
    rate_limit_per_min?: number;
    rate_limit_per_day?: number;
    allowed_types?: string[] | null;
  } | null;
  if (!body?.name?.trim()) return err("body.name is required");

  if (pastExpiry(body.expires_at)) return err("expires_at is in the past");

  if (body.allowed_types != null) {
    if (!Array.isArray(body.allowed_types) || body.allowed_types.some(t => !VALID_TYPES.has(t))) {
      return err("allowed_types must be an array of valid job types");
    }
  }

  const { key, raw } = await createApiKey(
    body.name.trim(),
    body.expires_at,
    body.rate_limit_per_min,
    body.rate_limit_per_day,
    body.allowed_types,
  );
  const { allowed_types, ...rest } = key as typeof key & { allowed_types: string | null };
  return Response.json({
    key: { ...rest, allowed_types: KeyPermissions.fromColumn(allowed_types).toList() },
    raw,
  }, { status: 201 });
}

export async function updateKeyHandler(req: Request, id: string): Promise<Response> {
  const body = await req.json().catch(() => null) as {
    expires_at?: number | null;
    rate_limit_per_min?: number | null;
    rate_limit_per_day?: number | null;
    allowed_types?: string[] | null;
  } | null;
  if (!body || typeof body !== "object") return err("Invalid body");

  if (pastExpiry(body.expires_at)) return err("expires_at is in the past");

  if ("allowed_types" in body && body.allowed_types != null) {
    if (!Array.isArray(body.allowed_types) || body.allowed_types.some(t => !VALID_TYPES.has(t))) {
      return err("allowed_types must be an array of valid job types");
    }
  }

  const fields: Parameters<typeof updateApiKey>[1] = {};
  if ("expires_at"         in body) fields.expires_at         = body.expires_at         ?? null;
  if ("rate_limit_per_min" in body) fields.rate_limit_per_min = body.rate_limit_per_min ?? null;
  if ("rate_limit_per_day" in body) fields.rate_limit_per_day = body.rate_limit_per_day ?? null;
  if ("allowed_types"      in body) fields.allowed_types      = body.allowed_types      ?? null;

  const ok = await updateApiKey(id, fields);
  if (!ok) return err("Key not found or revoked", 404);
  return new Response(null, { status: 204 });
}

export async function revokeKeyHandler(req: Request, id: string): Promise<Response> {
  const ok = await revokeApiKey(id);
  if (!ok) return err("Key not found or already revoked", 404);
  return new Response(null, { status: 204 });
}

export async function deleteKeyHandler(_req: Request, id: string): Promise<Response> {
  const ok = await deleteApiKey(id);
  if (!ok) return err("Key not found", 404);
  return new Response(null, { status: 204 });
}

// Self-service: returns the current key's own public metadata.
// No admin required — the key authenticates itself.
export async function getKeyMeHandler(req: Request): Promise<Response> {
  const key = await authenticateKey(req);
  if (!key) return err("Unauthorized", 401);
  return Response.json({
    name:               key.name,
    rate_limit_per_min: key.rate_limit_per_min ?? null,
    rate_limit_per_day: key.rate_limit_per_day ?? null,
    allowed_types:      KeyPermissions.fromColumn(key.allowed_types).toList(),
    expires_at:         key.expires_at ?? null,
  });
}
