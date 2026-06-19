import type { JobType } from "./execute-job";

// ─── Agent → Server ──────────────────────────────────────────────────────────

export interface AgentStartedEvent { event: "job:started"; jobId: string; }
export interface AgentDoneEvent    { event: "job:done";    jobId: string; }
export interface AgentFailedEvent  { event: "job:failed";  jobId: string; error: string; }
export type AgentEvent = AgentStartedEvent | AgentDoneEvent | AgentFailedEvent;

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
    if (typeof m["jobId"] !== "string") return null;
    const jobId = m["jobId"] as string;
    if (m["event"] === "job:started") return { event: "job:started", jobId };
    if (m["event"] === "job:done")    return { event: "job:done",    jobId };
    if (m["event"] === "job:failed")  return { event: "job:failed",  jobId, error: String(m["error"] ?? "unknown error") };
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
