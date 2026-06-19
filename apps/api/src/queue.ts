import {
  enqueueJob, listPendingJobs, updateJobStatus, getJob,
  incrementRetry, resetStuckJobs, resetJobForRetry,
  type Job, type JobType,
} from "./db";

export type BroadcastFn = (msg: object) => void;

export class Queue {
  constructor(
    private readonly broadcast: BroadcastFn,
    private readonly pushToAgent: (job: Job) => void,
  ) {}

  enqueue(type: JobType, payload: unknown, source: string): Job {
    const job = enqueueJob(type, payload, source);
    this.broadcast({ event: "job:queued", job: publicJob(job) });
    this.pushToAgent(job);
    return job;
  }

  onAgentConnected(): void {
    for (const job of listPendingJobs()) this.pushToAgent(job);
  }

  onJobStarted(id: string): void {
    updateJobStatus(id, "printing");
    const job = getJob(id);
    if (job) this.broadcast({ event: "job:printing", job: publicJob(job) });
  }

  onJobDone(id: string): void {
    updateJobStatus(id, "done");
    const job = getJob(id);
    if (job) this.broadcast({ event: "job:done", job: publicJob(job) });
  }

  onJobFailed(id: string, error: string): void {
    if (error.startsWith("printer_unavailable:")) {
      updateJobStatus(id, "pending");
      const job = getJob(id);
      if (job) this.broadcast({ event: "job:queued", job: publicJob(job) });
      return;
    }

    const retries = incrementRetry(id);
    if (retries < 2) {
      updateJobStatus(id, "pending");
      const job = getJob(id);
      if (job) {
        this.broadcast({ event: "job:queued", job: publicJob(job) });
        this.pushToAgent(job);
      }
    } else {
      updateJobStatus(id, "failed", error);
      const job = getJob(id);
      if (job) this.broadcast({ event: "job:failed", job: publicJob(job) });
    }
  }

  onAgentDisconnected(): void {
    const changed = resetStuckJobs();
    if (changed > 0) {
      this.broadcast({ event: "jobs:reset", jobs: listPendingJobs().map(publicJob) });
    }
  }

  retryJob(id: string): boolean {
    const job = getJob(id);
    if (!job || job.status !== "failed") return false;
    resetJobForRetry(id);
    const updated = getJob(id)!;
    this.broadcast({ event: "job:queued", job: publicJob(updated) });
    this.pushToAgent(updated);
    return true;
  }

  cancelJob(id: string): boolean {
    const job = getJob(id);
    if (!job || job.status === "done" || job.status === "cancelled" || job.status === "printing") return false;
    updateJobStatus(id, "cancelled");
    const updated = getJob(id)!;
    this.broadcast({ event: "job:cancelled", job: publicJob(updated) });
    return true;
  }
}

// ─── Module-level singleton ────────────────────────────────────────────────────

let _queue: Queue | null = null;

export function initQueue(opts: { broadcast: BroadcastFn; pushToAgent: (job: Job) => void }): Queue {
  _queue = new Queue(opts.broadcast, opts.pushToAgent);
  return _queue;
}

function q(): Queue {
  if (!_queue) throw new Error("Queue not initialized — call initQueue() first");
  return _queue;
}

// Thin wrappers so handlers don't need a queue reference
export const enqueue            = (type: JobType, payload: unknown, source: string) => q().enqueue(type, payload, source);
export const onAgentConnected   = () => q().onAgentConnected();
export const onJobStarted       = (id: string) => q().onJobStarted(id);
export const onJobDone          = (id: string) => q().onJobDone(id);
export const onJobFailed        = (id: string, error: string) => q().onJobFailed(id, error);
export const onAgentDisconnected = () => q().onAgentDisconnected();
export const retryJob           = (id: string) => q().retryJob(id);
export const cancelJob          = (id: string) => q().cancelJob(id);

export function publicJob(job: Job) {
  return {
    id:          job.id,
    type:        job.type,
    payload:     JSON.parse(job.payload) as unknown,
    status:      job.status,
    source:      job.source,
    retry_count: job.retry_count,
    error:       job.error,
    created_at:  job.created_at,
    updated_at:  job.updated_at,
  };
}
