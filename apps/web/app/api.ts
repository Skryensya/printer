// Client API. No system keys live here — every call that needs the admin or
// service key goes through the server-side proxy (app/server/printer.ts), so the
// keys stay on the web server and never reach the browser bundle.
import { apiFn, watchTokenFn, resetWallCooldownsFn, wallControlFn, type WallControls, type ProxyResult } from "./server/printer";

export type { WallControls };

// VITE_API_URL is a public URL (not a secret) — only used for the docs page,
// where the user pastes their OWN key (not a system key).
// Defaults to prod; set VITE_API_URL=http://localhost:5801 in .env for local dev.
// Trailing slashes are stripped so `${BASE}/api/...` never doubles up.
const BASE = (import.meta.env["VITE_API_URL"] ?? "https://printer-api.skryensya.dev").replace(/\/+$/, "");

// Typed wrapper around the server-fn proxy (the RPC stub returns `unknown`).
function call(data: { method: string; path: string; body?: unknown; admin?: boolean }): Promise<ProxyResult> {
  return apiFn({ data }) as Promise<ProxyResult>;
}

function parseBody<T>(r: ProxyResult): T {
  return (r.body ? JSON.parse(r.body) : null) as T;
}

function errorOf(r: ProxyResult): string {
  const e = parseBody<{ error?: string } | null>(r)?.error;
  return e ?? `HTTP ${r.status}`;
}

async function post(path: string, body: unknown, admin = false): Promise<void> {
  const r = await call({ method: "POST", path, body, admin });
  if (!r.ok) throw new Error(errorOf(r));
}

async function get<T>(path: string, admin = false): Promise<T> {
  const r = await call({ method: "GET", path, admin });
  if (!r.ok) throw new Error(errorOf(r));
  return parseBody<T>(r);
}

async function del(path: string, admin = false): Promise<void> {
  const r = await call({ method: "DELETE", path, admin });
  if (!r.ok) throw new Error(errorOf(r));
}

// ─── Agent status ─────────────────────────────────────────────────────────────

export type AgentStatus = "offline" | "printer_offline" | "ready";

export async function getAgentStatus(): Promise<AgentStatus | null> {
  try {
    const r = await call({ method: "GET", path: "/api/v1/agent", admin: true });
    if (!r.ok) return null;
    return parseBody<{ status: AgentStatus }>(r).status;
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

export type ImageEffect = "photo" | "invert";

export interface CardData {
  title?: string;
  badge?: string;
  from?:  string;
  label?: string;
  date?:  string;
  rows?:  [string, string, string?][];
  qr?:    string;
}

export function printTicket(card: CardData) { return post("/api/v1/print/ticket", card); }

export function printTodo(body: { items: (string | [string, string])[]; title?: string; badge?: string }) {
  return post("/api/v1/print/todo", body);
}

// Simple message card — from is locked to the key name on the server unless
// the key also holds the message_custom permission, in which case body.from is used.
export function printMessage(body: { message: string; from?: string }) {
  return post("/api/v1/print/message", body);
}

export function printImage(body: {
  image: string;
  mediaType?: string;
  effect?: ImageEffect;
}) { return post("/api/v1/print/image", body); }

export function printBorders() { return post("/api/v1/print/borders", {}); }
export function printTest()    { return post("/api/v1/print/test", {}); }

// ─── Job types ────────────────────────────────────────────────────────────────

export type JobStatus = "pending" | "printing" | "done" | "failed" | "cancelled";

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
  image_url?:  string | null; // archived original (R2), image jobs only
  sender_ip?:      string | null; // originating end-user IP (relayed pings only)
  sender_account?: string | null; // wall login name if signed in; null = anonymous
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
export function deleteJob(id: string) { return del(`/api/v1/jobs/${id}`, true); }

export async function reprintJob(id: string): Promise<{ id: string }> {
  const r = await call({ method: "POST", path: `/api/v1/jobs/${id}/reprint`, body: {}, admin: true });
  if (!r.ok) throw new Error(errorOf(r));
  return parseBody<{ id: string }>(r);
}

// ─── Admin: API keys ──────────────────────────────────────────────────────────

// Public permission types shown in the key management UI.
// message_custom is a superset of message — a key with message_custom can also
// override the "from" field; without it, "from" is always the key name.
export const ALL_PERMISSION_TYPES = [
  "text", "message", "message_custom", "ticket", "todo", "qr", "image",
] as const;
export type PermissionType = typeof ALL_PERMISSION_TYPES[number];

// Actual job queue types — includes barcode for historical entries that may
// already exist in the queue, even though the barcode endpoint is removed.
export const ALL_JOB_TYPES = ["text","ticket","todo","qr","barcode","image","borders","test"] as const;
export type JobType = typeof ALL_JOB_TYPES[number];

export interface ApiKey {
  id:                 string;
  name:               string;
  expires_at:         number | null;
  revoked_at:         number | null;
  created_at:         number;
  rate_limit_per_min: number | null;
  rate_limit_per_day: number | null;
  allowed_types:      string[] | null;  // null = all types allowed
  enqueued:           number;           // lifetime usage counters
  printed:            number;
  failed:             number;
}

export interface KeyStats {
  source:     string;
  enqueued:   number;
  printed:    number;
  failed:     number;
  updated_at: number;
}

export async function getKeyStats(): Promise<KeyStats[]> {
  const res = await get<{ stats: KeyStats[] }>("/api/v1/keys/stats", true);
  return res.stats;
}

export async function listKeys(): Promise<ApiKey[]> {
  const res = await get<{ keys: ApiKey[] }>("/api/v1/keys", true);
  return res.keys;
}

export async function createKey(params: {
  name: string;
  expires_at?: number;
  rate_limit_per_min?: number | null;
  rate_limit_per_day?: number | null;
  allowed_types?: string[] | null;
}): Promise<{ key: ApiKey; raw: string }> {
  const r = await call({ method: "POST", path: "/api/v1/keys", body: params, admin: true });
  if (!r.ok) throw new Error(errorOf(r));
  return parseBody<{ key: ApiKey; raw: string }>(r);
}

export async function updateKey(id: string, fields: {
  expires_at?: number | null;
  rate_limit_per_min?: number | null;
  rate_limit_per_day?: number | null;
  allowed_types?: string[] | null;
}): Promise<void> {
  const r = await call({ method: "PATCH", path: `/api/v1/keys/${id}`, body: fields, admin: true });
  if (!r.ok) throw new Error(errorOf(r));
}

export function revokeKey(id: string) { return post(`/api/v1/keys/${id}/revoke`, {}, true); }
export function deleteKey(id: string) { return del(`/api/v1/keys/${id}`, true); }

// ─── Key self-service ─────────────────────────────────────────────────────────

export interface KeyInfo {
  name:               string;
  rate_limit_per_min: number | null;
  rate_limit_per_day: number | null;
  allowed_types:      string[] | null;
  expires_at:         number | null;
}

// Outcome of validating a pasted key: its metadata, "rejected" (the API answered
// but the key is bad/expired), or "unreachable" (couldn't reach the API at all —
// wrong VITE_API_URL, server down, CORS). Keeping these apart matters: a network
// failure is not the key's fault, and conflating them sends you debugging the
// wrong thing.
export type KeyCheck = KeyInfo | "rejected" | "unreachable";

// Fetch the calling key's own metadata. The user pastes their OWN key here
// (docs page) — it's not a system secret, so this calls the API directly.
export async function getMyKey(apiKey: string): Promise<KeyCheck> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/v1/keys/me`, { headers: { "X-API-Key": apiKey } });
  } catch {
    return "unreachable"; // never got an answer (DNS, TLS, CORS, server down)
  }
  if (res.status === 401 || res.status === 403) return "rejected"; // bad/expired/revoked key
  if (!res.ok) return "unreachable"; // 5xx etc — the key isn't the problem
  return res.json() as Promise<KeyInfo>;
}

// ─── Wall accounts (admin backoffice) ─────────────────────────────────────────

export interface WallUser {
  username:     string;
  display_name: string;
  created_at:   number;
}

export async function listWallUsers(): Promise<WallUser[]> {
  const res = await get<{ users: WallUser[] }>("/api/v1/wall/users", true);
  return res.users;
}

export async function createWallUser(params: { username: string; password: string; display_name?: string }): Promise<WallUser> {
  const r = await call({ method: "POST", path: "/api/v1/wall/users", body: params, admin: true });
  if (!r.ok) throw new Error(errorOf(r));
  return parseBody<{ user: WallUser }>(r).user;
}

export function deleteWallUser(username: string) {
  return del(`/api/v1/wall/users/${encodeURIComponent(username)}`, true);
}

// Wipe every IP cooldown on the wall — a testing aid so the 30-min lockout
// doesn't block repeated test pings. Returns how many were cleared (null if the
// wall didn't report a count).
export async function resetWallCooldowns(): Promise<number | null> {
  const r = (await resetWallCooldownsFn()) as { ok: boolean; cleared: number | null; error?: string };
  if (!r.ok) throw new Error(r.error ?? "Could not reset cooldowns");
  return r.cleared;
}

// ─── Wall anti-abuse controls ─────────────────────────────────────────────────

async function wallControl(data: { action?: string; ip?: string; value?: string }): Promise<WallControls> {
  const r = (await wallControlFn({ data })) as { ok: boolean; controls: WallControls | null; error?: string };
  if (!r.ok || !r.controls) throw new Error(r.error ?? "Wall control request failed");
  return r.controls;
}

export const getWallControls   = ()                  => wallControl({ action: "status" });
export const setWallAnonBlocked = (blocked: boolean) => wallControl({ action: "set-anon", value: blocked ? "block" : "allow" });
export const blockWallIp       = (ip: string)        => wallControl({ action: "block-ip", ip });
export const unblockWallIp     = (ip: string)        => wallControl({ action: "unblock-ip", ip });
export const setWallCooldown   = (ms: number)        => wallControl({ action: "set-cooldown", value: String(ms) });

// ─── WebSocket URL ────────────────────────────────────────────────────────────

// Returns a watch WebSocket URL carrying a short-lived signed token (no admin
// key). Null if the user isn't authenticated.
export async function watchWsUrl(): Promise<string | null> {
  const { url } = await watchTokenFn();
  return url;
}
