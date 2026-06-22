import { describe, test, expect, beforeEach } from "bun:test";
import {
  resetDbForTest,
  enqueueJob, getJob, listJobs, listPendingJobs,
  updateJobStatus, incrementRetry, resetStuckJobs, resetJobForRetry,
  createApiKey, verifyApiKey, listApiKeys, revokeApiKey, deleteApiKey,
} from "./db";

beforeEach(async () => {
  await resetDbForTest();
});

// ─── Jobs ─────────────────────────────────────────────────────────────────────

describe("enqueueJob", () => {
  test("creates a job with pending status", async () => {
    const job = await enqueueJob("text", { text: "hello" }, "test-service");
    expect(job.status).toBe("pending");
    expect(job.type).toBe("text");
    expect(job.source).toBe("test-service");
    expect(job.retry_count).toBe(0);
    expect(job.error).toBeNull();
  });

  test("stores payload as JSON", async () => {
    const payload = { text: "hello", bold: true, size: 2 };
    const job = await enqueueJob("text", payload, "svc");
    expect(JSON.parse(job.payload)).toEqual(payload);
  });

  test("assigns a unique id each time", async () => {
    const a = await enqueueJob("text", {}, "svc");
    const b = await enqueueJob("text", {}, "svc");
    expect(a.id).not.toBe(b.id);
  });
});

describe("getJob", () => {
  test("returns null for unknown id", async () => {
    expect(await getJob("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  test("returns the job after enqueue", async () => {
    const job = await enqueueJob("ticket", { id: "1", title: "T" }, "svc");
    expect(await getJob(job.id)).toMatchObject({ id: job.id, type: "ticket" });
  });
});

describe("listJobs / listPendingJobs", () => {
  test("lists pending jobs in FIFO order", async () => {
    const a = await enqueueJob("text", {}, "svc");
    const b = await enqueueJob("qr", {}, "svc");
    const pending = await listPendingJobs();
    expect(pending[0]?.id).toBe(a.id);
    expect(pending[1]?.id).toBe(b.id);
  });

  test("filters by status", async () => {
    const job = await enqueueJob("text", {}, "svc");
    await updateJobStatus(job.id, "done");
    expect(await listJobs("done")).toHaveLength(1);
    expect(await listJobs("pending")).toHaveLength(0);
  });
});

describe("updateJobStatus", () => {
  test("changes status", async () => {
    const job = await enqueueJob("text", {}, "svc");
    await updateJobStatus(job.id, "printing");
    expect((await getJob(job.id))?.status).toBe("printing");
  });

  test("stores error message on failure", async () => {
    const job = await enqueueJob("text", {}, "svc");
    await updateJobStatus(job.id, "failed", "USB error");
    const updated = await getJob(job.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toBe("USB error");
  });
});

describe("incrementRetry", () => {
  test("starts at 0 and increments", async () => {
    const job = await enqueueJob("text", {}, "svc");
    expect(await incrementRetry(job.id)).toBe(1);
    expect(await incrementRetry(job.id)).toBe(2);
  });
});

describe("resetStuckJobs", () => {
  test("resets printing jobs to pending", async () => {
    const job = await enqueueJob("text", {}, "svc");
    await updateJobStatus(job.id, "printing");
    const changed = await resetStuckJobs();
    expect(changed).toBe(1);
    expect((await getJob(job.id))?.status).toBe("pending");
  });

  test("does not touch done or failed jobs", async () => {
    const a = await enqueueJob("text", {}, "svc");
    const b = await enqueueJob("text", {}, "svc");
    await updateJobStatus(a.id, "done");
    await updateJobStatus(b.id, "failed", "err");
    expect(await resetStuckJobs()).toBe(0);
    expect((await getJob(a.id))?.status).toBe("done");
    expect((await getJob(b.id))?.status).toBe("failed");
  });
});

describe("resetJobForRetry", () => {
  test("resets status to pending and clears retry_count and error", async () => {
    const job = await enqueueJob("text", {}, "svc");
    await updateJobStatus(job.id, "failed", "boom");
    await incrementRetry(job.id);
    await incrementRetry(job.id);

    await resetJobForRetry(job.id);
    const updated = (await getJob(job.id))!;
    expect(updated.status).toBe("pending");
    expect(updated.retry_count).toBe(0);
    expect(updated.error).toBeNull();
  });
});

// ─── API keys ─────────────────────────────────────────────────────────────────

describe("createApiKey / verifyApiKey", () => {
  test("raw key verifies against hashed record", async () => {
    const { raw } = await createApiKey("home-assistant");
    const key = await verifyApiKey(raw);
    expect(key).not.toBeNull();
    expect(key?.name).toBe("home-assistant");
  });

  test("wrong key returns null", async () => {
    await createApiKey("svc");
    expect(await verifyApiKey("wrong-key")).toBeNull();
  });

  test("revoked key returns null", async () => {
    const { key, raw } = await createApiKey("svc");
    await revokeApiKey(key.id);
    expect(await verifyApiKey(raw)).toBeNull();
  });

  test("expired key returns null", async () => {
    const pastTimestamp = Math.floor(Date.now() / 1000) - 1;
    const { raw } = await createApiKey("svc", pastTimestamp);
    expect(await verifyApiKey(raw)).toBeNull();
  });

  test("key with future expiry verifies", async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400;
    const { raw } = await createApiKey("svc", futureTimestamp);
    expect(await verifyApiKey(raw)).not.toBeNull();
  });
});

describe("listApiKeys", () => {
  test("does not expose hashed_key", async () => {
    await createApiKey("svc");
    const keys = await listApiKeys();
    expect(keys).toHaveLength(1);
    expect("hashed_key" in keys[0]!).toBe(false);
  });

  test("returns keys newest first", async () => {
    await createApiKey("first");
    await createApiKey("second");
    const keys = await listApiKeys();
    expect(keys[0]?.name).toBe("second");
    expect(keys[1]?.name).toBe("first");
  });
});

describe("revokeApiKey", () => {
  test("returns true on success", async () => {
    const { key } = await createApiKey("svc");
    expect(await revokeApiKey(key.id)).toBe(true);
  });

  test("returns false if already revoked", async () => {
    const { key } = await createApiKey("svc");
    await revokeApiKey(key.id);
    expect(await revokeApiKey(key.id)).toBe(false);
  });

  test("sets revoked_at timestamp", async () => {
    const { key } = await createApiKey("svc");
    await revokeApiKey(key.id);
    const keys = await listApiKeys();
    expect(keys[0]?.revoked_at).not.toBeNull();
  });
});

describe("deleteApiKey", () => {
  test("removes the key", async () => {
    const { key } = await createApiKey("svc");
    expect(await deleteApiKey(key.id)).toBe(true);
    expect(await listApiKeys()).toHaveLength(0);
  });

  test("returns false for unknown id", async () => {
    expect(await deleteApiKey("00000000-0000-0000-0000-000000000000")).toBe(false);
  });
});
