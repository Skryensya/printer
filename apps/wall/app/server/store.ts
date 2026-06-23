// Server-only state: the message queue, the per-IP cooldown ledger, and the
// rate-limit budget we learn from the printer API's response headers.
//
// Persisted to a JSON file so (a) the queue survives a dev restart and (b) the
// per-IP cooldown can't be reset by bouncing the process. A single long-lived
// node server owns this module, so a plain module-level singleton is correct.

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";

export type EntryStatus = "pending" | "printing" | "printed" | "failed";

export interface QueueEntry {
  id:        string;
  message:   string;
  from:      string;
  ip:        string;        // never sent to the client
  username:  string | null; // set when a logged-in account sent it; null = anon
  hasImage:  boolean;       // an attached photo to print after the message
  status:    EntryStatus;
  createdAt: number;
  printedAt: number | null;
  jobId:     string | null; // id returned by the printer API
  error:     string | null;
}

// Attached photos live in memory only — NOT persisted to the JSON state file
// (base64 would bloat it). They drain within seconds; a restart mid-flight just
// drops the unsent photo, which is acceptable. `original` is the full-res file
// to archive (the API stores it); `data` is the 384px bitmap to print.
type PendingImage = { data: string; mediaType: string; original?: string; originalMediaType?: string };
const pendingImages = new Map<string, PendingImage>();

export function getImage(id: string): PendingImage | undefined {
  return pendingImages.get(id);
}

export function dropImage(id: string): void {
  pendingImages.delete(id);
}

// ─── Persisted photo thumbnails ───────────────────────────────────────────────
// The 384px print bitmap is saved to disk (as a PNG file, NOT in state.json) so
// the sender can see what they printed in their history. Kept until the entry is
// evicted from the queue. Always PNG (the composer renders the bitmap as PNG).

function photosDir(): string {
  return join(config.dataDir, "photos");
}

function savePhoto(id: string, base64: string): void {
  try {
    mkdirSync(photosDir(), { recursive: true });
    writeFileSync(join(photosDir(), `${id}.png`), Buffer.from(base64, "base64"));
  } catch (e) {
    console.error("[wall] failed to save photo:", e);
  }
}

function deletePhoto(id: string): void {
  try { unlinkSync(join(photosDir(), `${id}.png`)); } catch { /* already gone */ }
}

// The saved print bitmap as base64, or null if there isn't one.
export function getStoredPhoto(id: string): string | null {
  try {
    const p = join(photosDir(), `${id}.png`);
    if (!existsSync(p)) return null;
    return readFileSync(p).toString("base64");
  } catch { return null; }
}

export function getEntry(id: string): QueueEntry | undefined {
  return getState().queue.find(e => e.id === id);
}

// What we know about how much the API will still let us send. `null` for a
// dimension means the key is unlimited on that dimension (no header present).
export interface Budget {
  remainingMinute: number | null;
  resetMinuteAt:   number;   // epoch ms
  remainingDay:    number | null;
  resetDayAt:      number;   // epoch ms
}

interface State {
  queue:     QueueEntry[];
  cooldowns: Record<string, number>; // ip -> last accepted submission (epoch ms)
  budget:    Budget;
}

const MAX_QUEUE = 200;

function emptyState(): State {
  return {
    queue:     [],
    cooldowns: {},
    budget:    { remainingMinute: null, resetMinuteAt: 0, remainingDay: null, resetDayAt: 0 },
  };
}

let state: State | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function statePath(): string {
  return join(config.dataDir, "state.json");
}

function load(): State {
  try {
    if (existsSync(statePath())) {
      const raw = readFileSync(statePath(), "utf8");
      const parsed = JSON.parse(raw) as Partial<State>;
      return { ...emptyState(), ...parsed, budget: { ...emptyState().budget, ...parsed.budget } };
    }
  } catch (e) {
    console.error("[wall] failed to load state, starting fresh:", e);
  }
  return emptyState();
}

function getState(): State {
  if (state === null) state = load();
  return state;
}

function scheduleSave(): void {
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(config.dataDir, { recursive: true });
      writeFileSync(statePath(), JSON.stringify(getState()), "utf8");
    } catch (e) {
      console.error("[wall] failed to persist state:", e);
    }
  }, 250);
}

// ─── Cooldown ─────────────────────────────────────────────────────────────────

export function cooldownRemaining(ip: string, now = Date.now()): number {
  const last = getState().cooldowns[ip];
  if (last === undefined) return 0;
  return Math.max(0, last + config.cooldownMs - now);
}

export function recordSubmission(ip: string, now = Date.now()): void {
  getState().cooldowns[ip] = now;
  scheduleSave();
}

// Release an IP's cooldown — used when a print ultimately fails, so a failed
// job doesn't lock the visitor out.
export function clearCooldown(ip: string): void {
  delete getState().cooldowns[ip];
  scheduleSave();
}

// ─── Queue ──────────────────────────────────────────────────────────────────

export function enqueue(
  message: string, from: string, ip: string,
  username: string | null = null,
  image: PendingImage | null = null,
): QueueEntry {
  const entry: QueueEntry = {
    id:        crypto.randomUUID(),
    message,
    from,
    ip,
    username,
    hasImage:  !!image,
    status:    "pending",
    createdAt: Date.now(),
    printedAt: null,
    jobId:     null,
    error:     null,
  };
  if (image) {
    pendingImages.set(entry.id, image);   // full payload to print (dropped after)
    savePhoto(entry.id, image.data);       // 384px thumbnail kept for viewing
  }
  const s = getState();
  s.queue.unshift(entry);
  if (s.queue.length > MAX_QUEUE) {
    for (const dropped of s.queue.slice(MAX_QUEUE)) {
      pendingImages.delete(dropped.id);
      deletePhoto(dropped.id);
    }
    s.queue.length = MAX_QUEUE;
  }
  scheduleSave();
  return entry;
}

export function nextPending(): QueueEntry | undefined {
  // Oldest pending first (queue is newest-first, so scan from the end).
  const s = getState();
  for (let i = s.queue.length - 1; i >= 0; i--) {
    if (s.queue[i]!.status === "pending") return s.queue[i];
  }
  return undefined;
}

export function updateEntry(id: string, patch: Partial<QueueEntry>): void {
  const entry = getState().queue.find(e => e.id === id);
  if (entry) Object.assign(entry, patch);
  scheduleSave();
}

export function listQueue(): QueueEntry[] {
  return getState().queue;
}

// Anonymous pings from this IP only. Account-tagged pings are deliberately
// excluded — even though they share the device IP, they must be visible solely
// when logged into that account, never after logout.
export function listQueueForIp(ip: string): QueueEntry[] {
  return getState().queue.filter(e => e.ip === ip && e.username === null);
}

// A logged-in account's own messages, across IPs/devices.
export function listQueueForUser(username: string): QueueEntry[] {
  return getState().queue.filter(e => e.username === username);
}

export function pendingCount(): number {
  return getState().queue.filter(e => e.status === "pending" || e.status === "printing").length;
}

// ─── Budget ───────────────────────────────────────────────────────────────────

export function getBudget(): Budget {
  return getState().budget;
}

export function setBudget(patch: Partial<Budget>): void {
  Object.assign(getState().budget, patch);
  scheduleSave();
}

// True when the API headers tell us there is no room left to send right now.
export function budgetExhausted(now = Date.now()): boolean {
  const b = getState().budget;
  if (b.remainingMinute !== null && b.remainingMinute <= 0 && now < b.resetMinuteAt) return true;
  if (b.remainingDay !== null && b.remainingDay <= 0 && now < b.resetDayAt) return true;
  return false;
}
