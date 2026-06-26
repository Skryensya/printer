// Server-only state: the message queue, the per-IP cooldown ledger, and the
// rate-limit budget we learn from the printer API's response headers.
//
// Persisted to a JSON file so (a) the queue survives a dev restart and (b) the
// per-IP cooldown can't be reset by bouncing the process. A single long-lived
// node server owns this module, so a plain module-level singleton is correct.

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync, statSync } from "node:fs";
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
  jobId:     string | null;      // message print job id
  imageJobId: string | null;     // image print job id — used to read its R2 url
  error:     string | null;
  hidden:    boolean;            // owner hid it from their history (still printed/archived)
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

// Delete thumbnail files older than the TTL. R2 is the permanent store; the disk
// copy only needs to bridge the upload window. By mtime, so it also clears
// orphans left by a restart. Runs periodically (see ensurePhotoSweep).
export function sweepExpiredPhotos(now = Date.now()): void {
  const dir = photosDir();
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    try {
      const p = join(dir, file);
      if (now - statSync(p).mtimeMs > config.photoTtlMs) unlinkSync(p);
    } catch { /* already gone / unreadable */ }
  }
}

let sweepStarted = false;
export function ensurePhotoSweep(): void {
  if (sweepStarted) return;
  sweepStarted = true;
  sweepExpiredPhotos();                              // once at boot (clears orphans)
  setInterval(() => sweepExpiredPhotos(), 10 * 60_000); // then every 10 min
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

// Anti-abuse controls, toggled from print-admin. `anonBlocked` pauses ALL
// anonymous pings; `blockedIps` blocks specific IPs (anon or not). Logged-in
// accounts are always allowed through.
export interface Controls {
  anonBlocked: boolean;
  blockedIps:  string[];
  cooldownMs:  number;  // per-IP cooldown window for anon pings (admin-configurable)
}

interface State {
  queue:     QueueEntry[];
  cooldowns: Record<string, number>; // ip -> last accepted submission (epoch ms)
  budget:    Budget;
  controls:  Controls;
}

const MAX_QUEUE = 200;

function emptyState(): State {
  return {
    queue:     [],
    cooldowns: {},
    budget:    { remainingMinute: null, resetMinuteAt: 0, remainingDay: null, resetDayAt: 0 },
    controls:  { anonBlocked: false, blockedIps: [], cooldownMs: config.cooldownMs },
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
      return {
        ...emptyState(), ...parsed,
        budget:   { ...emptyState().budget, ...parsed.budget },
        controls: { ...emptyState().controls, ...parsed.controls },
      };
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
  return Math.max(0, last + getState().controls.cooldownMs - now);
}

// The current cooldown window (ms). Admin-configurable; falls back to the env
// default until changed.
export function cooldownWindowMs(): number {
  return getState().controls.cooldownMs;
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

// Wipe every IP's cooldown at once. A testing aid, triggered from the admin's
// "reset wall cooldowns" button, so the 30-min lockout doesn't get in the way of
// repeated test pings. Returns how many cooldowns were cleared.
export function clearAllCooldowns(): number {
  const s = getState();
  const n = Object.keys(s.cooldowns).length;
  s.cooldowns = {};
  scheduleSave();
  return n;
}

// ─── Anti-abuse controls ──────────────────────────────────────────────────────

export function getControls(): Controls {
  return getState().controls;
}

export function setAnonBlocked(blocked: boolean): void {
  getState().controls.anonBlocked = blocked;
  scheduleSave();
}

// Normalize then add/remove an IP from the blocklist (no duplicates).
export function blockIp(ip: string): void {
  const c = getState().controls;
  const v = ip.trim();
  if (v && !c.blockedIps.includes(v)) c.blockedIps.push(v);
  scheduleSave();
}

export function unblockIp(ip: string): void {
  const c = getState().controls;
  c.blockedIps = c.blockedIps.filter(x => x !== ip.trim());
  scheduleSave();
}

// Set the per-IP cooldown window. Clamped to a sane range (1s–24h) so a bad
// value can't lock everyone out forever or disable the limit entirely.
export function setCooldownMs(ms: number): void {
  if (!Number.isFinite(ms)) return;
  getState().controls.cooldownMs = Math.min(24 * 60 * 60 * 1000, Math.max(1000, Math.round(ms)));
  scheduleSave();
}

// Whether an anonymous visitor from this IP may submit right now. Used both to
// reject at submit time and to show the "paused" mode proactively. Logged-in
// accounts bypass this entirely (checked by the caller).
export function anonAllowed(ip: string): boolean {
  const c = getState().controls;
  return !c.anonBlocked && !c.blockedIps.includes(ip);
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
    status:     "pending",
    createdAt:  Date.now(),
    printedAt:  null,
    jobId:      null,
    imageJobId: null,
    error:      null,
    hidden:     false,
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

// Anonymous pings from this IP only, minus ones the visitor hid. Account-tagged
// pings are deliberately excluded — even though they share the device IP, they
// must be visible solely when logged into that account, never after logout.
export function listQueueForIp(ip: string): QueueEntry[] {
  return getState().queue.filter(e => e.ip === ip && e.username === null && !e.hidden);
}

// A logged-in account's own messages, across IPs/devices, minus hidden ones.
export function listQueueForUser(username: string): QueueEntry[] {
  return getState().queue.filter(e => e.username === username && !e.hidden);
}

// Hide an entry from its owner's history. The entry stays in the queue (so it
// still drains/prints) and the printer API job + archive are untouched — this is
// a view-only flag, not a delete.
export function hideEntry(id: string): void {
  const entry = getState().queue.find(e => e.id === id);
  if (entry) { entry.hidden = true; scheduleSave(); }
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
