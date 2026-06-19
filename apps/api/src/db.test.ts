import { describe, test, expect, beforeEach } from "bun:test";
import {
  initDb,
  enqueueJob, getJob, listJobs, listPendingJobs,
  updateJobStatus, incrementRetry, resetStuckJobs, resetJobForRetry,
  createApiKey, verifyApiKey, listApiKeys, revokeApiKey, deleteApiKey,
} from "./db";

beforeEach(() => {
  initDb(":memory:");
});

// ─── Jobs ─────────────────────────────────────────────────────────────────────

describe("enqueueJob", () => {
  test("creates a job with pending status", () => {
    const job = enqueueJob("text", { text: "hello" }, "test-service");
    expect(job.status).toBe("pending");
    expect(job.type).toBe("text");
    expect(job.source).toBe("test-service");
    expect(job.retry_count).toBe(0);
    expect(job.error).toBeNull();
  });

  test("stores payload as JSON", () => {
    const payload = { text: "hello", bold: true, size: 2 };
    const job = enqueueJob("text", payload, "svc");
    expect(JSON.parse(job.payload)).toEqual(payload);
  });

  test("assigns a unique id each time", () => {
    const a = enqueueJob("text", {}, "svc");
    const b = enqueueJob("text", {}, "svc");
    expect(a.id).not.toBe(b.id);
  });
});

describe("getJob", () => {
  test("returns null for unknown id", () => {
    expect(getJob("does-not-exist")).toBeNull();
  });

  test("returns the job after enqueue", () => {
    const job = enqueueJob("ticket", { id: "1", title: "T" }, "svc");
    expect(getJob(job.id)).toMatchObject({ id: job.id, type: "ticket" });
  });
});

describe("listJobs / listPendingJobs", () => {
  test("lists pending jobs in FIFO order", () => {
    const a = enqueueJob("text", {}, "svc");
    const b = enqueueJob("qr", {}, "svc");
    const pending = listPendingJobs();
    expect(pending[0]?.id).toBe(a.id);
    expect(pending[1]?.id).toBe(b.id);
  });

  test("filters by status", () => {
    const job = enqueueJob("text", {}, "svc");
    updateJobStatus(job.id, "done");
    expect(listJobs("done")).toHaveLength(1);
    expect(listJobs("pending")).toHaveLength(0);
  });
});

describe("updateJobStatus", () => {
  test("changes status", () => {
    const job = enqueueJob("text", {}, "svc");
    updateJobStatus(job.id, "printing");
    expect(getJob(job.id)?.status).toBe("printing");
  });

  test("stores error message on failure", () => {
    const job = enqueueJob("text", {}, "svc");
    updateJobStatus(job.id, "failed", "USB error");
    const updated = getJob(job.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toBe("USB error");
  });
});

describe("incrementRetry", () => {
  test("starts at 0 and increments", () => {
    const job = enqueueJob("text", {}, "svc");
    expect(incrementRetry(job.id)).toBe(1);
    expect(incrementRetry(job.id)).toBe(2);
  });
});

describe("resetStuckJobs", () => {
  test("resets printing jobs to pending", () => {
    const job = enqueueJob("text", {}, "svc");
    updateJobStatus(job.id, "printing");
    const changed = resetStuckJobs();
    expect(changed).toBe(1);
    expect(getJob(job.id)?.status).toBe("pending");
  });

  test("does not touch done or failed jobs", () => {
    const a = enqueueJob("text", {}, "svc");
    const b = enqueueJob("text", {}, "svc");
    updateJobStatus(a.id, "done");
    updateJobStatus(b.id, "failed", "err");
    expect(resetStuckJobs()).toBe(0);
    expect(getJob(a.id)?.status).toBe("done");
    expect(getJob(b.id)?.status).toBe("failed");
  });
});

describe("resetJobForRetry", () => {
  test("resets status to pending and clears retry_count and error", () => {
    const job = enqueueJob("text", {}, "svc");
    updateJobStatus(job.id, "failed", "boom");
    incrementRetry(job.id);
    incrementRetry(job.id);

    resetJobForRetry(job.id);
    const updated = getJob(job.id)!;
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
    revokeApiKey(key.id);
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
    const keys = listApiKeys();
    expect(keys).toHaveLength(1);
    expect("hashed_key" in keys[0]!).toBe(false);
  });

  test("returns keys newest first", async () => {
    await createApiKey("first");
    await createApiKey("second");
    const keys = listApiKeys();
    expect(keys[0]?.name).toBe("second");
    expect(keys[1]?.name).toBe("first");
  });
});

describe("revokeApiKey", () => {
  test("returns true on success", async () => {
    const { key } = await createApiKey("svc");
    expect(revokeApiKey(key.id)).toBe(true);
  });

  test("returns false if already revoked", async () => {
    const { key } = await createApiKey("svc");
    revokeApiKey(key.id);
    expect(revokeApiKey(key.id)).toBe(false);
  });

  test("sets revoked_at timestamp", async () => {
    const { key } = await createApiKey("svc");
    revokeApiKey(key.id);
    const keys = listApiKeys();
    expect(keys[0]?.revoked_at).not.toBeNull();
  });
});

describe("deleteApiKey", () => {
  test("removes the key", async () => {
    const { key } = await createApiKey("svc");
    expect(deleteApiKey(key.id)).toBe(true);
    expect(listApiKeys()).toHaveLength(0);
  });

  test("returns false for unknown id", () => {
    expect(deleteApiKey("nonexistent")).toBe(false);
  });
});
