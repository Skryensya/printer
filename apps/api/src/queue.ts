import {
  enqueueJob, listPendingJobs, updateJobStatus, getJob,
  incrementRetry, resetStuckJobs, resetJobForRetry, incrementKeyStat,
  type Job, type JobType,
} from "./db";
import type { JobFailureReason, WatcherEvent } from "@printer/core";

export type BroadcastFn = (msg: WatcherEvent) => void;

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

  async enqueue(type: JobType, payload: unknown, source: string): Promise<Job> {
    const job = await enqueueJob(type, payload, source);
    await incrementKeyStat(source, "enqueued");
    this.broadcast({ event: "job:queued", job: publicJob(job) });
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
    await updateJobStatus(id, "printing");
    const job = await getJob(id);
    if (job) this.broadcast({ event: "job:printing", job: publicJob(job) });
  }

  async onJobDone(id: string): Promise<void> {
    await updateJobStatus(id, "done");
    const job = await getJob(id);
    if (job) {
      await incrementKeyStat(job.source, "printed");
      this.broadcast({ event: "job:done", job: publicJob(job) });
    }
  }

  async onJobFailed(id: string, error: string, reason: JobFailureReason = "job_error"): Promise<void> {
    if (reason === "printer_unavailable") {
      await updateJobStatus(id, "pending");
      const job = await getJob(id);
      if (job) this.broadcast({ event: "job:queued", job: publicJob(job) });
      return;
    }

    const retries = await incrementRetry(id);
    if (retries < MAX_JOB_RETRIES) {
      await updateJobStatus(id, "pending");
      const job = await getJob(id);
      if (job) {
        this.broadcast({ event: "job:queued", job: publicJob(job) });
        this.schedule(job);
      }
    } else {
      await updateJobStatus(id, "failed", error);
      const job = await getJob(id);
      if (job) {
        await incrementKeyStat(job.source, "failed");
        this.broadcast({ event: "job:failed", job: publicJob(job) });
      }
    }
  }

  async onAgentDisconnected(): Promise<void> {
    const changed = await resetStuckJobs();
    if (changed > 0) {
      this.broadcast({ event: "jobs:reset", jobs: (await listPendingJobs()).map(publicJob) });
    }
  }

  async retryJob(id: string): Promise<boolean> {
    const job = await getJob(id);
    if (!job || job.status === "pending" || job.status === "printing" || job.status === "done") return false;
    await resetJobForRetry(id);
    const updated = await getJob(id);
    if (!updated) return false;
    this.broadcast({ event: "job:queued", job: publicJob(updated) });
    this.schedule(updated);
    return true;
  }

  async cancelJob(id: string): Promise<boolean> {
    const job = await getJob(id);
    if (!job || job.status === "done" || job.status === "cancelled" || job.status === "printing") return false;
    await updateJobStatus(id, "cancelled");
    this.dispatchQueue = this.dispatchQueue.filter(j => j.id !== id);
    const updated = await getJob(id);
    if (!updated) return false;
    this.broadcast({ event: "job:cancelled", job: publicJob(updated) });
    return true;
  }

  async reprintJob(id: string): Promise<Job | null> {
    const job = await getJob(id);
    if (!job || job.status !== "done") return null;
    return this.enqueue(job.type, JSON.parse(job.payload) as unknown, job.source);
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

export const enqueue             = (type: JobType, payload: unknown, source: string) => q().enqueue(type, payload, source);
export const onAgentConnected    = () => q().onAgentConnected();
export const onJobStarted        = (id: string) => q().onJobStarted(id);
export const onJobDone           = (id: string) => q().onJobDone(id);
export const onJobFailed         = (id: string, error: string, reason?: JobFailureReason) => q().onJobFailed(id, error, reason);
export const onAgentDisconnected = () => q().onAgentDisconnected();
export const retryJob            = (id: string) => q().retryJob(id);
export const cancelJob           = (id: string) => q().cancelJob(id);
export const reprintJob          = (id: string) => q().reprintJob(id);

export function publicJob(job: Job) {
  const payload = JSON.parse(job.payload) as Record<string, unknown>;
  if (job.type === "image" && typeof payload["image"] === "string") {
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
  };
}
