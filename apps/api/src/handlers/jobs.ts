import { getJob, listJobs, deleteJob as dbDeleteJob, type JobStatus } from "../db";
import { retryJob, cancelJob, reprintJob, publicJob } from "../queue";

function err(msg: string, status = 400): Response {
  return Response.json({ error: msg }, { status });
}

// source=null means admin (unrestricted); source=string means service key (own jobs only).
export async function getJobHandler(_req: Request, id: string, source: string | null): Promise<Response> {
  const job = await getJob(id);
  if (!job) return err("Job not found", 404);
  if (source !== null && job.source !== source) return err("Job not found", 404);
  // Return full payload for single-job fetch (list endpoint strips large fields like image base64)
  return Response.json({ job: publicJob(job, true) });
}

export async function listJobsHandler(req: Request): Promise<Response> {
  const url    = new URL(req.url);
  const status = url.searchParams.get("status") as JobStatus | null;
  const jobs   = (await listJobs(status ?? undefined)).map(j => publicJob(j));
  return Response.json({ jobs });
}

export async function retryJobHandler(_req: Request, id: string): Promise<Response> {
  const ok = await retryJob(id);
  if (!ok) return err("Job not found or not in failed state", 404);
  return new Response(null, { status: 204 });
}

export async function cancelJobHandler(_req: Request, id: string): Promise<Response> {
  const ok = await cancelJob(id);
  if (!ok) return err("Job not found or cannot be cancelled", 404);
  return new Response(null, { status: 204 });
}

export async function deleteJobHandler(_req: Request, id: string): Promise<Response> {
  const ok = await dbDeleteJob(id);
  if (!ok) return err("Job not found or currently printing", 409);
  return new Response(null, { status: 204 });
}

export async function reprintJobHandler(_req: Request, id: string): Promise<Response> {
  const job = await reprintJob(id);
  if (!job) return err("Job not found or not in done state", 404);
  return new Response(JSON.stringify({ id: job.id }), {
    status: 202,
    headers: { "Content-Type": "application/json", "Location": `/api/v1/jobs/${job.id}` },
  });
}
