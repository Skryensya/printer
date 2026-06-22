import { describe, test, expect, beforeEach, afterEach, jest } from "bun:test";
import { resetDbForTest, getJob } from "./db";
import { Queue } from "./queue";

let q: Queue;
let broadcasts: object[] = [];
let pushes: string[] = [];

beforeEach(async () => {
  await resetDbForTest();
  broadcasts = [];
  pushes = [];
  jest.useFakeTimers();
  q = new Queue(
    (msg) => { broadcasts.push(msg); },
    (job) => { pushes.push(job.id); return true; },
  );
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── enqueue ──────────────────────────────────────────────────────────────────

describe("enqueue", () => {
  test("creates a pending job and notifies watcher + agent", async () => {
    const job = await q.enqueue("text", { text: "hi" }, "svc");
    expect(job.status).toBe("pending");
    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as { event: string }).event).toBe("job:queued");
    jest.runAllTimers(); // fire the pump
    expect(pushes).toContain(job.id);
  });
});

// ─── onJobStarted / onJobDone ──────────────────────────────────────────────────

describe("onJobStarted", () => {
  test("sets status to printing and broadcasts", async () => {
    const job = await q.enqueue("text", {}, "svc");
    broadcasts = [];
    await q.onJobStarted(job.id);
    expect((await getJob(job.id))?.status).toBe("printing");
    expect((broadcasts[0] as { event: string }).event).toBe("job:printing");
  });
});

describe("onJobDone", () => {
  test("sets status to done and broadcasts", async () => {
    const job = await q.enqueue("text", {}, "svc");
    await q.onJobStarted(job.id);
    broadcasts = [];
    await q.onJobDone(job.id);
    expect((await getJob(job.id))?.status).toBe("done");
    expect((broadcasts[0] as { event: string }).event).toBe("job:done");
  });
});

// ─── onJobFailed ──────────────────────────────────────────────────────────────

describe("onJobFailed — printer unavailable", () => {
  test("keeps job pending (no retry consumed)", async () => {
    const job = await q.enqueue("text", {}, "svc");
    await q.onJobStarted(job.id);
    broadcasts = [];
    pushes = [];

    await q.onJobFailed(job.id, "POS-58 not found", "printer_unavailable");

    const updated = (await getJob(job.id))!;
    expect(updated.status).toBe("pending");
    expect(updated.retry_count).toBe(0);
    expect((broadcasts[0] as { event: string }).event).toBe("job:queued");
    expect(pushes).toHaveLength(0); // pump is stalled — printer not ready
  });
});

describe("onJobFailed — first real failure", () => {
  test("resets to pending for one automatic retry", async () => {
    const job = await q.enqueue("text", {}, "svc");
    await q.onJobStarted(job.id);
    pushes = [];
    broadcasts = [];

    await q.onJobFailed(job.id, "USB transfer failed: stall");
    jest.runAllTimers(); // fire the pump

    const updated = (await getJob(job.id))!;
    expect(updated.status).toBe("pending");
    expect(updated.retry_count).toBe(1);
    expect(pushes).toContain(job.id);
    expect((broadcasts[0] as { event: string }).event).toBe("job:queued");
  });
});

describe("onJobFailed — second failure", () => {
  test("marks job as permanently failed", async () => {
    const job = await q.enqueue("text", {}, "svc");
    await q.onJobStarted(job.id);
    await q.onJobFailed(job.id, "USB error");
    jest.runAllTimers();
    await q.onJobStarted(job.id);
    broadcasts = [];

    await q.onJobFailed(job.id, "USB error again");

    const updated = (await getJob(job.id))!;
    expect(updated.status).toBe("failed");
    expect(updated.retry_count).toBe(2);
    expect(updated.error).toBe("USB error again");
    expect((broadcasts[0] as { event: string }).event).toBe("job:failed");
  });
});

// ─── retryJob ─────────────────────────────────────────────────────────────────

describe("retryJob", () => {
  test("resets a failed job to pending with fresh retry count", async () => {
    const job = await q.enqueue("text", {}, "svc");
    await q.onJobStarted(job.id);
    await q.onJobFailed(job.id, "err");
    jest.runAllTimers();
    await q.onJobStarted(job.id);
    await q.onJobFailed(job.id, "err");
    expect((await getJob(job.id))?.status).toBe("failed");

    pushes = [];
    const ok = await q.retryJob(job.id);
    jest.runAllTimers(); // fire the pump
    expect(ok).toBe(true);

    const updated = (await getJob(job.id))!;
    expect(updated.status).toBe("pending");
    expect(updated.retry_count).toBe(0);
    expect(updated.error).toBeNull();
    expect(pushes).toContain(job.id);
  });

  test("returns false for a job that is not in failed state", async () => {
    const job = await q.enqueue("text", {}, "svc");
    expect(await q.retryJob(job.id)).toBe(false);
  });
});

// ─── cancelJob ────────────────────────────────────────────────────────────────

describe("cancelJob", () => {
  test("cancels a pending job", async () => {
    const job = await q.enqueue("text", {}, "svc");
    expect(await q.cancelJob(job.id)).toBe(true);
    expect((await getJob(job.id))?.status).toBe("cancelled");
    expect((broadcasts.at(-1) as { event: string }).event).toBe("job:cancelled");
  });

  test("cannot cancel a printing job", async () => {
    const job = await q.enqueue("text", {}, "svc");
    await q.onJobStarted(job.id);
    expect(await q.cancelJob(job.id)).toBe(false);
    expect((await getJob(job.id))?.status).toBe("printing");
  });

  test("cannot cancel a done job", async () => {
    const job = await q.enqueue("text", {}, "svc");
    await q.onJobStarted(job.id);
    await q.onJobDone(job.id);
    expect(await q.cancelJob(job.id)).toBe(false);
  });
});

// ─── onAgentConnected ─────────────────────────────────────────────────────────

describe("onAgentConnected", () => {
  test("pushes all pending jobs to the agent", async () => {
    const a = await q.enqueue("text", {}, "svc");
    const b = await q.enqueue("qr", {}, "svc");
    pushes = [];

    await q.onAgentConnected();
    jest.runAllTimers(); // fire the pump for all pending jobs

    expect(pushes).toContain(a.id);
    expect(pushes).toContain(b.id);
  });

  test("does not push done or failed jobs", async () => {
    const job = await q.enqueue("text", {}, "svc");
    await q.onJobStarted(job.id);
    await q.onJobDone(job.id);
    pushes = [];

    await q.onAgentConnected();
    jest.runAllTimers();
    expect(pushes).toHaveLength(0);
  });
});

// ─── onAgentDisconnected ──────────────────────────────────────────────────────

describe("onAgentDisconnected", () => {
  test("resets printing jobs to pending", async () => {
    const job = await q.enqueue("text", {}, "svc");
    await q.onJobStarted(job.id);
    expect((await getJob(job.id))?.status).toBe("printing");

    broadcasts = [];
    await q.onAgentDisconnected();

    expect((await getJob(job.id))?.status).toBe("pending");
    expect((broadcasts[0] as { event: string }).event).toBe("jobs:reset");
  });

  test("broadcasts nothing when no jobs were stuck", async () => {
    broadcasts = [];
    await q.onAgentDisconnected();
    expect(broadcasts).toHaveLength(0);
  });
});
