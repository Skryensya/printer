const BASE       = import.meta.env["VITE_API_URL"]       ?? "http://localhost:3001";
const KEY        = import.meta.env["VITE_API_KEY"]       ?? "";
const ADMIN_KEY  = import.meta.env["VITE_ADMIN_API_KEY"] ?? "";

function headers(admin = false) {
  return { "Content-Type": "application/json", "X-API-Key": admin ? ADMIN_KEY : KEY };
}

async function post(path: string, body: unknown, admin = false): Promise<void> {
  const res  = await fetch(`${BASE}${path}`, { method: "POST", headers: headers(admin), body: JSON.stringify(body) });
  const json = await res.json() as { ok: boolean; error?: string };
  if (!json.ok) throw new Error(json.error ?? "Unknown error");
}

async function get<T>(path: string, admin = false): Promise<T> {
  const res  = await fetch(`${BASE}${path}`, { headers: headers(admin) });
  const json = await res.json() as { ok: boolean; error?: string } & T;
  if (!json.ok) throw new Error(json.error ?? "Unknown error");
  return json;
}

async function del(path: string, admin = false): Promise<void> {
  const res  = await fetch(`${BASE}${path}`, { method: "DELETE", headers: headers(admin) });
  const json = await res.json() as { ok: boolean; error?: string };
  if (!json.ok) throw new Error(json.error ?? "Unknown error");
}

// ─── Agent status ─────────────────────────────────────────────────────────────

export async function getAgentStatus(): Promise<boolean | null> {
  try {
    const res  = await fetch(`${BASE}/api/v1/agent`);
    const json = await res.json() as { ok: boolean; connected: boolean };
    return json.ok ? json.connected : null;
  } catch {
    return null;
  }
}

// ─── Print functions ──────────────────────────────────────────────────────────

export function printText(body: {
  text: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  size?: number;
  invert?: boolean;
}) { return post("/api/v1/print/text", body); }

export function printTicket(body: {
  id: string;
  title: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "TODO" | "IN PROGRESS" | "DONE" | "BLOCKED";
  assignee?: string;
  due?: string;
  tags?: string[];
  style?: "ascii" | "thin" | "double" | "block" | "shade" | "stars";
}) { return post("/api/v1/print/ticket", body); }

export function printQr(body: {
  text: string;
  size?: number;
  errorLevel?: "L" | "M" | "Q" | "H";
}) { return post("/api/v1/print/qr", body); }

export function printBarcode(body: {
  data: string;
  height?: number;
}) { return post("/api/v1/print/barcode", body); }

export function printImage(body: {
  image: string;
  mediaType?: string;
}) { return post("/api/v1/print/image", body); }

export function printBorders() { return post("/api/v1/print/borders", {}); }
export function printTest()    { return post("/api/v1/print/test", {}); }

// ─── Job types ────────────────────────────────────────────────────────────────

export type JobStatus = "pending" | "printing" | "done" | "failed" | "cancelled";
export type JobType   = "text" | "ticket" | "qr" | "barcode" | "image" | "borders" | "test";

export interface PrintJob {
  id:          string;
  type:        JobType;
  payload:     unknown;
  status:      JobStatus;
  source:      string;
  retry_count: number;
  error:       string | null;
  created_at:  number;
  updated_at:  number;
}

// ─── Admin: jobs ──────────────────────────────────────────────────────────────

export async function listJobs(status?: JobStatus): Promise<PrintJob[]> {
  const qs  = status ? `?status=${status}` : "";
  const res = await get<{ jobs: PrintJob[] }>(`/api/v1/jobs${qs}`, true);
  return res.jobs;
}

export async function getJob(id: string): Promise<PrintJob> {
  const res = await get<{ job: PrintJob }>(`/api/v1/jobs/${id}`);
  return res.job;
}

export function retryJob(id: string)  { return post(`/api/v1/jobs/${id}/retry`, {}, true); }
export function cancelJob(id: string) { return post(`/api/v1/jobs/${id}/cancel`, {}, true); }

// ─── Admin: API keys ──────────────────────────────────────────────────────────

export interface ApiKey {
  id:         string;
  name:       string;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
}

export async function listKeys(): Promise<ApiKey[]> {
  const res = await get<{ keys: ApiKey[] }>("/api/v1/keys", true);
  return res.keys;
}

export async function createKey(name: string, expires_at?: number): Promise<{ key: ApiKey; raw: string }> {
  const res = await fetch(`${BASE}/api/v1/keys`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ name, expires_at }),
  });
  const json = await res.json() as { ok: boolean; key: ApiKey; raw: string; error?: string };
  if (!json.ok) throw new Error(json.error ?? "Unknown error");
  return { key: json.key, raw: json.raw };
}

export function revokeKey(id: string) { return post(`/api/v1/keys/${id}/revoke`, {}, true); }
export function deleteKey(id: string) { return del(`/api/v1/keys/${id}`, true); }

// ─── WebSocket URL ────────────────────────────────────────────────────────────

export function watchWsUrl(): string {
  const ws = BASE.replace(/^http/, "ws");
  return `${ws}/ws/watch?key=${encodeURIComponent(ADMIN_KEY)}`;
}
