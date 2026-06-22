import type { JobType } from "./execute-job";

// ─── Server → Watcher (WebSocket watch channel) ───────────────────────────────
// Shared between queue.ts (broadcaster) and the web UI (subscriber).

export interface PublicJob {
  id:          string;
  type:        JobType;
  payload:     unknown;
  status:      "pending" | "printing" | "done" | "failed" | "cancelled";
  source:      string;
  retry_count: number;
  error:       string | null;
  created_at:  number;
  updated_at:  number;
}

export type WatcherEvent =
  | { event: "job:queued";    job:  PublicJob }
  | { event: "job:printing";  job:  PublicJob }
  | { event: "job:done";      job:  PublicJob }
  | { event: "job:failed";    job:  PublicJob }
  | { event: "job:cancelled"; job:  PublicJob }
  | { event: "jobs:reset";    jobs: PublicJob[] };

// ─── Agent → Server ──────────────────────────────────────────────────────────

// Typed discriminant for why a job failed. Using an enum value over the wire
// (rather than a string prefix) keeps the Agent and API in sync at the type
// level — a mismatch is a compile error, not a silent behavior change.
export type JobFailureReason = "printer_unavailable" | "job_error";

export interface AgentStartedEvent      { event: "job:started"; jobId: string; }
export interface AgentDoneEvent         { event: "job:done";    jobId: string; }
export interface AgentFailedEvent {
  event:  "job:failed";
  jobId:  string;
  reason: JobFailureReason; // why — drives retry / requeue logic on the server
  error:  string;           // human-readable message for logging
}
export interface AgentPrinterReadyEvent        { event: "printer:ready"; }
export interface AgentPrinterDisconnectedEvent { event: "printer:disconnected"; }
export type AgentEvent =
  | AgentStartedEvent
  | AgentDoneEvent
  | AgentFailedEvent
  | AgentPrinterReadyEvent
  | AgentPrinterDisconnectedEvent;

// ─── Server → Agent ──────────────────────────────────────────────────────────

export interface PrintJobEvent {
  event: "job:print";
  job: { id: string; type: JobType; payload: unknown };
}
export type ServerEvent = PrintJobEvent | { event: "connected" };

// ─── Parse ───────────────────────────────────────────────────────────────────

export function parseAgentEvent(raw: string | Buffer): AgentEvent | null {
  try {
    const m = JSON.parse(String(raw)) as Record<string, unknown>;
    if (m["event"] === "printer:ready")        return { event: "printer:ready" };
    if (m["event"] === "printer:disconnected") return { event: "printer:disconnected" };
    if (typeof m["jobId"] !== "string") return null;
    const jobId = m["jobId"] as string;
    if (m["event"] === "job:started") return { event: "job:started", jobId };
    if (m["event"] === "job:done")    return { event: "job:done",    jobId };
    if (m["event"] === "job:failed") {
      const reason: JobFailureReason =
        m["reason"] === "printer_unavailable" ? "printer_unavailable" : "job_error";
      return { event: "job:failed", jobId, reason, error: String(m["error"] ?? "unknown error") };
    }
    return null;
  } catch { return null; }
}

export function parseServerEvent(raw: string): ServerEvent | null {
  try {
    const m = JSON.parse(raw) as Record<string, unknown>;
    if (m["event"] === "connected") return { event: "connected" };
    if (m["event"] === "job:print") {
      const j = m["job"] as Record<string, unknown> | undefined;
      if (!j || typeof j["id"] !== "string" || typeof j["type"] !== "string") return null;
      return {
        event: "job:print",
        job: { id: j["id"] as string, type: j["type"] as JobType, payload: j["payload"] },
      };
    }
    return null;
  } catch { return null; }
}
