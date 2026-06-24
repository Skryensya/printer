import {
  enqueueJob, listPendingJobs, updateJobStatus, getJob,
  incrementRetry, resetStuckJobs, resetJobForRetry, incrementKeyStat,
  type Job, type JobType, type JobStatus, type JobMeta,
} from "./db";
import type { JobFailureReason, WatcherEvent } from "@printer/core";

export type BroadcastFn = (msg: WatcherEvent) => void;

// The WatcherEvent variants that carry a single Job (everything but jobs:reset).
type SingleJobEvent = "job:queued" | "job:printing" | "job:done" | "job:failed" | "job:cancelled";

const MAX_JOB_RETRIES = 2;
const DISPATCH_INTERVAL_MS = 300;

export class Queue {
  private dispatchQueue: Job[] = [];
  private lastDispatchAt  = 0;
  private dispatchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly broadcast: BroadcastFn,
    private readonly pushToAgent: (job: Job) => boolean,
  ) {}

  private schedule(job: Job): void {
    if (!this.dispatchQueue.some(j => j.id === job.id)) {
      this.dispatchQueue.push(job);
    }
    this.pump();
  }

  // ─── Status transition seam ───────────────────────────────────────────────
  // "Move a Job to a status and tell the Watchers" lives here once. Callers name
  // the transition; they don't reload the row and re-broadcast by hand.

  private announce(event: SingleJobEvent, job: Job): void {
    this.broadcast({ event, job: publicJob(job) } as WatcherEvent);
  }

  private async transition(
    id: string,
    status: JobStatus,
    event: SingleJobEvent,
    error?: string,
  ): Promise<Job | null> {
    await updateJobStatus(id, status, error);
    const job = await getJob(id);
    if (job) this.announce(event, job);
    return job;
  }

  private pump(): void {
    if (this.dispatchTimer !== null || this.dispatchQueue.length === 0) return;
    const wait = Math.max(0, DISPATCH_INTERVAL_MS - (Date.now() - this.lastDispatchAt));
    this.dispatchTimer = setTimeout(() => {
      this.dispatchTimer = null;
      const next = this.dispatchQueue[0];
      if (next) {
        const sent = this.pushToAgent(next);
        if (sent) {
          this.dispatchQueue.shift();
          this.lastDispatchAt = Date.now();
          this.pump();
        }
      }
    }, wait);
  }

  async enqueue(type: JobType, payload: unknown, source: string, meta?: JobMeta): Promise<Job> {
    const job = await enqueueJob(type, payload, source, meta);
    await incrementKeyStat(source, "enqueued");
    this.announce("job:queued", job);
    this.schedule(job);
    return job;
  }

  async onAgentConnected(): Promise<void> {
    this.dispatchQueue = [];
    if (this.dispatchTimer !== null) {
      clearTimeout(this.dispatchTimer);
      this.dispatchTimer = null;
    }
    for (const job of await listPendingJobs()) this.schedule(job);
  }

  async onJobStarted(id: string): Promise<void> {
    await this.transition(id, "printing", "job:printing");
  }

  async onJobDone(id: string): Promise<void> {
    const job = await this.transition(id, "done", "job:done");
    if (job) await incrementKeyStat(job.source, "printed");
  }

  async onJobFailed(id: string, error: string, reason: JobFailureReason = "job_error"): Promise<void> {
    if (reason === "printer_unavailable") {
      await this.transition(id, "pending", "job:queued");
      return;
    }

    const retries = await incrementRetry(id);
    if (retries < MAX_JOB_RETRIES) {
      const job = await this.transition(id, "pending", "job:queued");
      if (job) this.schedule(job);
    } else {
      const job = await this.transition(id, "failed", "job:failed", error);
      if (job) await incrementKeyStat(job.source, "failed");
    }
  }

  async onAgentDisconnected(): Promise<void> {
    const changed = await resetStuckJobs();
    if (changed > 0) {
      this.broadcast({ event: "jobs:reset", jobs: (await listPendingJobs()).map(j => publicJob(j)) });
    }
  }

  async retryJob(id: string): Promise<boolean> {
    const job = await getJob(id);
    if (!job || job.status === "pending" || job.status === "printing" || job.status === "done") return false;
    // resetJobForRetry also zeroes retry_count and clears the error, so it can't
    // go through transition() (which only sets status).
    await resetJobForRetry(id);
    const updated = await getJob(id);
    if (!updated) return false;
    this.announce("job:queued", updated);
    this.schedule(updated);
    return true;
  }

  async cancelJob(id: string): Promise<boolean> {
    const job = await getJob(id);
    if (!job || job.status === "done" || job.status === "cancelled" || job.status === "printing") return false;
    this.dispatchQueue = this.dispatchQueue.filter(j => j.id !== id);
    return (await this.transition(id, "cancelled", "job:cancelled")) !== null;
  }

  async reprintJob(id: string): Promise<Job | null> {
    const job = await getJob(id);
    if (!job || job.status !== "done") return null;
    // Preserve the original sender attribution on the reprint.
    return this.enqueue(job.type, jobPayload(job), job.source, {
      senderIp: job.sender_ip, senderAccount: job.sender_account,
    });
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _queue: Queue | null = null;

export function initQueue(opts: { broadcast: BroadcastFn; pushToAgent: (job: Job) => boolean }): Queue {
  _queue = new Queue(opts.broadcast, opts.pushToAgent);
  return _queue;
}

function q(): Queue {
  if (!_queue) throw new Error("Queue not initialized — call initQueue() first");
  return _queue;
}

export const enqueue             = (type: JobType, payload: unknown, source: string, meta?: JobMeta) => q().enqueue(type, payload, source, meta);
export const onAgentConnected    = () => q().onAgentConnected();
export const onJobStarted        = (id: string) => q().onJobStarted(id);
export const onJobDone           = (id: string) => q().onJobDone(id);
export const onJobFailed         = (id: string, error: string, reason?: JobFailureReason) => q().onJobFailed(id, error, reason);
export const onAgentDisconnected = () => q().onAgentDisconnected();
export const retryJob            = (id: string) => q().retryJob(id);
export const cancelJob           = (id: string) => q().cancelJob(id);
export const reprintJob          = (id: string) => q().reprintJob(id);

// The Job's stored payload as its parsed object — the one place the JSON-string
// representation is decoded for consumers that need the raw payload (agent push,
// reprint). Watcher/HTTP views go through publicJob instead.
export function jobPayload(job: Job): unknown {
  return JSON.parse(job.payload);
}

// `full` returns the unredacted payload (single-job fetch); the default redacts
// large image base64 for the list/broadcast view.
export function publicJob(job: Job, full = false) {
  const payload = JSON.parse(job.payload) as Record<string, unknown>;
  if (!full && job.type === "image" && typeof payload["image"] === "string") {
    payload["image"] = `[base64 ${Math.round(payload["image"].length * 3 / 4 / 1024)} KB]`;
  }
  return {
    id:          job.id,
    type:        job.type,
    payload,
    status:      job.status,
    source:      job.source,
    retry_count: job.retry_count,
    error:       job.error,
    created_at:  job.created_at,
    updated_at:  job.updated_at,
    image_url:   job.image_url,
    sender_ip:      job.sender_ip,
    sender_account: job.sender_account,
  };
}
