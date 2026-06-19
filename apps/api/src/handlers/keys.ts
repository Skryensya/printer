import { createApiKey, listApiKeys, revokeApiKey, deleteApiKey } from "../db";

function err(msg: string, status = 400): Response {
  return Response.json({ ok: false, error: msg }, { status });
}

export async function listKeysHandler(_req: Request): Promise<Response> {
  return Response.json({ ok: true, keys: listApiKeys() });
}

export async function createKeyHandler(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null) as { name?: string; expires_at?: number } | null;
  if (!body?.name?.trim()) return err("body.name is required");

  const { key, raw } = await createApiKey(body.name.trim(), body.expires_at);
  return Response.json({ ok: true, key, raw }, { status: 201 });
}

export async function revokeKeyHandler(req: Request, id: string): Promise<Response> {
  const ok = revokeApiKey(id);
  if (!ok) return err("Key not found or already revoked", 404);
  return Response.json({ ok: true });
}

export async function deleteKeyHandler(_req: Request, id: string): Promise<Response> {
  const ok = deleteApiKey(id);
  if (!ok) return err("Key not found", 404);
  return Response.json({ ok: true });
}
