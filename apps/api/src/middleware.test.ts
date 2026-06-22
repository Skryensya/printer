import { describe, test, expect, beforeEach } from "bun:test";
import { resetDbForTest, createApiKey } from "./db";
import { withServiceAuth, withAdminAuth } from "./middleware/auth";

const ok = () => new Response("ok", { status: 200 });

function makeReq(key?: string, via: "header" | "bearer" = "header"): Request {
  const headers = new Headers();
  if (key) {
    if (via === "bearer") headers.set("Authorization", `Bearer ${key}`);
    else headers.set("X-API-Key", key);
  }
  return new Request("http://localhost/", { headers });
}

beforeEach(async () => {
  await resetDbForTest();
  process.env["ADMIN_API_KEY"] = "test-admin-key";
});

// ─── withServiceAuth ──────────────────────────────────────────────────────────

describe("withServiceAuth", () => {
  test("passes valid key and forwards source name", async () => {
    const { raw } = await createApiKey("my-service");
    let capturedSource = "";
    const handler = withServiceAuth(null, (_req, source) => {
      capturedSource = source;
      return ok();
    });
    const res = await handler(makeReq(raw));
    expect(res.status).toBe(200);
    expect(capturedSource).toBe("my-service");
  });

  test("rejects missing key with 401", async () => {
    const handler = withServiceAuth(null, ok);
    const res = await handler(makeReq());
    expect(res.status).toBe(401);
  });

  test("rejects wrong key with 401", async () => {
    await createApiKey("svc");
    const handler = withServiceAuth(null, ok);
    const res = await handler(makeReq("not-the-right-key"));
    expect(res.status).toBe(401);
  });

  test("rejects revoked key", async () => {
    const { key, raw } = await createApiKey("svc");
    const { revokeApiKey } = await import("./db");
    await revokeApiKey(key.id);
    const handler = withServiceAuth(null, ok);
    const res = await handler(makeReq(raw));
    expect(res.status).toBe(401);
  });

  test("rejects expired key", async () => {
    const past = Math.floor(Date.now() / 1000) - 1;
    const { raw } = await createApiKey("svc", past);
    const handler = withServiceAuth(null, ok);
    const res = await handler(makeReq(raw));
    expect(res.status).toBe(401);
  });

  test("accepts key via Authorization: Bearer header", async () => {
    const { raw } = await createApiKey("svc");
    const handler = withServiceAuth(null, ok);
    const res = await handler(makeReq(raw, "bearer"));
    expect(res.status).toBe(200);
  });
});

// ─── withAdminAuth ────────────────────────────────────────────────────────────

describe("withAdminAuth", () => {
  test("passes correct admin key", async () => {
    const handler = withAdminAuth(ok);
    const res = await handler(makeReq("test-admin-key"));
    expect(res.status).toBe(200);
  });

  test("rejects wrong admin key with 401", async () => {
    const handler = withAdminAuth(ok);
    const res = await handler(makeReq("wrong"));
    expect(res.status).toBe(401);
  });

  test("rejects missing key with 401", async () => {
    const handler = withAdminAuth(ok);
    const res = await handler(makeReq());
    expect(res.status).toBe(401);
  });

  test("returns 503 when ADMIN_API_KEY is not configured", async () => {
    delete process.env["ADMIN_API_KEY"];
    const handler = withAdminAuth(ok);
    const res = await handler(makeReq("anything"));
    expect(res.status).toBe(503);
  });
});
