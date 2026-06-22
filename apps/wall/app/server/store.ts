// Server-only state: the message queue, the per-IP cooldown ledger, and the
// rate-limit budget we learn from the printer API's response headers.
//
// Persisted to a JSON file so (a) the queue survives a dev restart and (b) the
// per-IP cooldown can't be reset by bouncing the process. A single long-lived
// node server owns this module, so a plain module-level singleton is correct.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";

export type EntryStatus = "pending" | "printing" | "printed" | "failed";

export interface QueueEntry {
  id:        string;
  message:   string;
  from:      string;
  ip:        string;        // never sent to the client
  status:    EntryStatus;
  createdAt: number;
  printedAt: number | null;
  jobId:     string | null; // id returned by the printer API
  error:     string | null;
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

export function enqueue(message: string, from: string, ip: string): QueueEntry {
  const entry: QueueEntry = {
    id:        crypto.randomUUID(),
    message,
    from,
    ip,
    status:    "pending",
    createdAt: Date.now(),
    printedAt: null,
    jobId:     null,
    error:     null,
  };
  const s = getState();
  s.queue.unshift(entry);
  if (s.queue.length > MAX_QUEUE) s.queue.length = MAX_QUEUE;
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

// Only the entries submitted from this IP — each visitor sees just their own.
export function listQueueForIp(ip: string): QueueEntry[] {
  return getState().queue.filter(e => e.ip === ip);
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
