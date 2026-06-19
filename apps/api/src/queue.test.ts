import { describe, test, expect, beforeEach } from "bun:test";
import { initDb, getJob } from "./db";
import { Queue } from "./queue";

let q: Queue;
let broadcasts: object[] = [];
let pushes: string[] = [];

beforeEach(() => {
  initDb(":memory:");
  broadcasts = [];
  pushes = [];
  q = new Queue(
    (msg) => { broadcasts.push(msg); },
    (job) => { pushes.push(job.id); },
  );
});

// ─── enqueue ──────────────────────────────────────────────────────────────────

describe("enqueue", () => {
  test("creates a pending job and notifies watcher + agent", () => {
    const job = q.enqueue("text", { text: "hi" }, "svc");
    expect(job.status).toBe("pending");
    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as { event: string }).event).toBe("job:queued");
    expect(pushes).toContain(job.id);
  });
});

// ─── onJobStarted / onJobDone ──────────────────────────────────────────────────

describe("onJobStarted", () => {
  test("sets status to printing and broadcasts", () => {
    const job = q.enqueue("text", {}, "svc");
    broadcasts = [];
    q.onJobStarted(job.id);
    expect(getJob(job.id)?.status).toBe("printing");
    expect((broadcasts[0] as { event: string }).event).toBe("job:printing");
  });
});

describe("onJobDone", () => {
  test("sets status to done and broadcasts", () => {
    const job = q.enqueue("text", {}, "svc");
    q.onJobStarted(job.id);
    broadcasts = [];
    q.onJobDone(job.id);
    expect(getJob(job.id)?.status).toBe("done");
    expect((broadcasts[0] as { event: string }).event).toBe("job:done");
  });
});

// ─── onJobFailed ──────────────────────────────────────────────────────────────

describe("onJobFailed — printer unavailable", () => {
  test("keeps job pending (no retry consumed)", () => {
    const job = q.enqueue("text", {}, "svc");
    q.onJobStarted(job.id);
    broadcasts = [];
    pushes = [];

    q.onJobFailed(job.id, "printer_unavailable:POS-58 not found");

    const updated = getJob(job.id)!;
    expect(updated.status).toBe("pending");
    expect(updated.retry_count).toBe(0);
    expect((broadcasts[0] as { event: string }).event).toBe("job:queued");
    expect(pushes).toHaveLength(0);
  });
});

describe("onJobFailed — first real failure", () => {
  test("resets to pending for one automatic retry", () => {
    const job = q.enqueue("text", {}, "svc");
    q.onJobStarted(job.id);
    pushes = [];
    broadcasts = [];

    q.onJobFailed(job.id, "USB transfer failed: stall");

    const updated = getJob(job.id)!;
    expect(updated.status).toBe("pending");
    expect(updated.retry_count).toBe(1);
    expect(pushes).toContain(job.id);
    expect((broadcasts[0] as { event: string }).event).toBe("job:queued");
  });
});

describe("onJobFailed — second failure", () => {
  test("marks job as permanently failed", () => {
    const job = q.enqueue("text", {}, "svc");
    q.onJobStarted(job.id);
    q.onJobFailed(job.id, "USB error");
    q.onJobStarted(job.id);
    broadcasts = [];

    q.onJobFailed(job.id, "USB error again");

    const updated = getJob(job.id)!;
    expect(updated.status).toBe("failed");
    expect(updated.retry_count).toBe(2);
    expect(updated.error).toBe("USB error again");
    expect((broadcasts[0] as { event: string }).event).toBe("job:failed");
  });
});

// ─── retryJob ─────────────────────────────────────────────────────────────────

describe("retryJob", () => {
  test("resets a failed job to pending with fresh retry count", () => {
    const job = q.enqueue("text", {}, "svc");
    q.onJobStarted(job.id);
    q.onJobFailed(job.id, "err");
    q.onJobStarted(job.id);
    q.onJobFailed(job.id, "err");
    expect(getJob(job.id)?.status).toBe("failed");

    pushes = [];
    const ok = q.retryJob(job.id);
    expect(ok).toBe(true);

    const updated = getJob(job.id)!;
    expect(updated.status).toBe("pending");
    expect(updated.retry_count).toBe(0);
    expect(updated.error).toBeNull();
    expect(pushes).toContain(job.id);
  });

  test("returns false for a job that is not in failed state", () => {
    const job = q.enqueue("text", {}, "svc");
    expect(q.retryJob(job.id)).toBe(false);
  });
});

// ─── cancelJob ────────────────────────────────────────────────────────────────

describe("cancelJob", () => {
  test("cancels a pending job", () => {
    const job = q.enqueue("text", {}, "svc");
    expect(q.cancelJob(job.id)).toBe(true);
    expect(getJob(job.id)?.status).toBe("cancelled");
    expect((broadcasts.at(-1) as { event: string }).event).toBe("job:cancelled");
  });

  test("cannot cancel a printing job", () => {
    const job = q.enqueue("text", {}, "svc");
    q.onJobStarted(job.id);
    expect(q.cancelJob(job.id)).toBe(false);
    expect(getJob(job.id)?.status).toBe("printing");
  });

  test("cannot cancel a done job", () => {
    const job = q.enqueue("text", {}, "svc");
    q.onJobStarted(job.id);
    q.onJobDone(job.id);
    expect(q.cancelJob(job.id)).toBe(false);
  });
});

// ─── onAgentConnected ─────────────────────────────────────────────────────────

describe("onAgentConnected", () => {
  test("pushes all pending jobs to the agent", () => {
    const a = q.enqueue("text", {}, "svc");
    const b = q.enqueue("qr", {}, "svc");
    pushes = [];

    q.onAgentConnected();

    expect(pushes).toContain(a.id);
    expect(pushes).toContain(b.id);
  });

  test("does not push done or failed jobs", () => {
    const job = q.enqueue("text", {}, "svc");
    q.onJobStarted(job.id);
    q.onJobDone(job.id);
    pushes = [];

    q.onAgentConnected();
    expect(pushes).toHaveLength(0);
  });
});

// ─── onAgentDisconnected ──────────────────────────────────────────────────────

describe("onAgentDisconnected", () => {
  test("resets printing jobs to pending", () => {
    const job = q.enqueue("text", {}, "svc");
    q.onJobStarted(job.id);
    expect(getJob(job.id)?.status).toBe("printing");

    broadcasts = [];
    q.onAgentDisconnected();

    expect(getJob(job.id)?.status).toBe("pending");
    expect((broadcasts[0] as { event: string }).event).toBe("jobs:reset");
  });

  test("broadcasts nothing when no jobs were stuck", () => {
    broadcasts = [];
    q.onAgentDisconnected();
    expect(broadcasts).toHaveLength(0);
  });
});
