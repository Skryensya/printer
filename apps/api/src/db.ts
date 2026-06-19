import { Database } from "bun:sqlite";
import { join } from "node:path";

const DB_PATH = process.env["DB_PATH"] ?? join(import.meta.dir, "..", "printer.db");

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  _db = new Database(DB_PATH, { create: true });
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA foreign_keys = ON");
  migrate(_db);
  return _db;
}

// Replace the singleton with a fresh in-memory DB — for tests only
export function initDb(path: string = ":memory:"): Database {
  if (_db) { try { _db.close(); } catch {} }
  _db = new Database(path, { create: true });
  _db.run("PRAGMA foreign_keys = ON");
  migrate(_db);
  return _db;
}

function migrate(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id          TEXT    PRIMARY KEY,
      type        TEXT    NOT NULL,
      payload     TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'pending',
      source      TEXT    NOT NULL DEFAULT 'unknown',
      retry_count INTEGER NOT NULL DEFAULT 0,
      error       TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id          TEXT    PRIMARY KEY,
      name        TEXT    NOT NULL UNIQUE,
      hashed_key  TEXT    NOT NULL UNIQUE,
      expires_at  INTEGER,
      revoked_at  INTEGER,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
}

// ─── Job helpers ─────────────────────────────────────────────────────────────

export type JobStatus = "pending" | "printing" | "done" | "failed" | "cancelled";
export type JobType   = "text" | "ticket" | "qr" | "barcode" | "image" | "borders" | "test";

export interface Job {
  id:          string;
  type:        JobType;
  payload:     string; // JSON
  status:      JobStatus;
  source:      string;
  retry_count: number;
  error:       string | null;
  created_at:  number;
  updated_at:  number;
}

export function enqueueJob(type: JobType, payload: unknown, source: string): Job {
  const db = getDb();
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO jobs (id, type, payload, source) VALUES (?, ?, ?, ?)`,
    [id, type, JSON.stringify(payload), source],
  );
  return db.query<Job, [string]>(`SELECT * FROM jobs WHERE id = ?`).get(id)!;
}

export function getJob(id: string): Job | null {
  return getDb().query<Job, [string]>(`SELECT * FROM jobs WHERE id = ?`).get(id);
}

export function listJobs(status?: JobStatus): Job[] {
  const db = getDb();
  if (status) {
    return db.query<Job, [string]>(
      `SELECT * FROM jobs WHERE status = ? ORDER BY created_at ASC`
    ).all(status);
  }
  return db.query<Job, []>(`SELECT * FROM jobs ORDER BY created_at DESC`).all();
}

export function listPendingJobs(): Job[] {
  return listJobs("pending");
}

export function updateJobStatus(
  id: string,
  status: JobStatus,
  error?: string,
): void {
  getDb().run(
    `UPDATE jobs SET status = ?, error = ?, updated_at = unixepoch() WHERE id = ?`,
    [status, error ?? null, id],
  );
}

export function incrementRetry(id: string): number {
  const db = getDb();
  db.run(
    `UPDATE jobs SET retry_count = retry_count + 1, updated_at = unixepoch() WHERE id = ?`,
    [id],
  );
  return (db.query<{ retry_count: number }, [string]>(
    `SELECT retry_count FROM jobs WHERE id = ?`
  ).get(id)?.retry_count ?? 0);
}

export function resetJobForRetry(id: string): void {
  getDb().run(
    `UPDATE jobs SET status = 'pending', retry_count = 0, error = NULL, updated_at = unixepoch() WHERE id = ?`,
    [id],
  );
}

export function resetStuckJobs(): number {
  const result = getDb().run(
    `UPDATE jobs SET status = 'pending', updated_at = unixepoch() WHERE status = 'printing'`
  );
  return result.changes;
}

// ─── API key helpers ──────────────────────────────────────────────────────────

export interface ApiKey {
  id:         string;
  name:       string;
  hashed_key: string;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
}

async function hashKey(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}

export async function createApiKey(name: string, expiresAt?: number): Promise<{ key: ApiKey; raw: string }> {
  const db = getDb();
  const id  = crypto.randomUUID();
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
  const hashed = await hashKey(raw);
  db.run(
    `INSERT INTO api_keys (id, name, hashed_key, expires_at) VALUES (?, ?, ?, ?)`,
    [id, name, hashed, expiresAt ?? null],
  );
  const key = db.query<ApiKey, [string]>(`SELECT * FROM api_keys WHERE id = ?`).get(id)!;
  return { key, raw };
}

export async function verifyApiKey(raw: string): Promise<ApiKey | null> {
  const hashed = await hashKey(raw);
  const key = getDb().query<ApiKey, [string]>(
    `SELECT * FROM api_keys WHERE hashed_key = ?`
  ).get(hashed);
  if (!key) return null;
  if (key.revoked_at !== null) return null;
  if (key.expires_at !== null && key.expires_at < Math.floor(Date.now() / 1000)) return null;
  return key;
}

export function listApiKeys(): Omit<ApiKey, "hashed_key">[] {
  return getDb().query<Omit<ApiKey, "hashed_key">, []>(
    `SELECT id, name, expires_at, revoked_at, created_at FROM api_keys ORDER BY created_at DESC, rowid DESC`
  ).all();
}

export function revokeApiKey(id: string): boolean {
  const result = getDb().run(
    `UPDATE api_keys SET revoked_at = unixepoch() WHERE id = ? AND revoked_at IS NULL`,
    [id],
  );
  return result.changes > 0;
}

export function deleteApiKey(id: string): boolean {
  const result = getDb().run(`DELETE FROM api_keys WHERE id = ?`, [id]);
  return result.changes > 0;
}
