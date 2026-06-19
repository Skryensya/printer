import { getJob, listJobs, type JobStatus } from "../db";
import { retryJob, cancelJob, publicJob } from "../queue";

function err(msg: string, status = 400): Response {
  return Response.json({ ok: false, error: msg }, { status });
}

export function getJobHandler(_req: Request, id: string): Response {
  const job = getJob(id);
  if (!job) return err("Job not found", 404);
  return Response.json({ ok: true, job: publicJob(job) });
}

export function listJobsHandler(req: Request): Response {
  const url    = new URL(req.url);
  const status = url.searchParams.get("status") as JobStatus | null;
  const jobs   = listJobs(status ?? undefined).map(publicJob);
  return Response.json({ ok: true, jobs });
}

export function retryJobHandler(_req: Request, id: string): Response {
  const ok = retryJob(id);
  if (!ok) return err("Job not found or not in failed state", 404);
  return Response.json({ ok: true });
}

export function cancelJobHandler(_req: Request, id: string): Response {
  const ok = cancelJob(id);
  if (!ok) return err("Job not found or cannot be cancelled", 404);
  return Response.json({ ok: true });
}
