import { sql } from "bun";

// ─── Migration ────────────────────────────────────────────────────────────────

export async function migrate(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS jobs (
      seq         BIGSERIAL,
      id          TEXT    PRIMARY KEY,
      type        TEXT    NOT NULL,
      payload     TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'pending',
      source      TEXT    NOT NULL DEFAULT 'unknown',
      retry_count INTEGER NOT NULL DEFAULT 0,
      error       TEXT,
      created_at  INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::int,
      updated_at  INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::int
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      seq                BIGSERIAL,
      id                 TEXT    PRIMARY KEY,
      name               TEXT    NOT NULL UNIQUE,
      hashed_key         TEXT    NOT NULL UNIQUE,
      expires_at         INTEGER,
      revoked_at         INTEGER,
      created_at         INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::int,
      rate_limit_per_min INTEGER,
      rate_limit_per_day INTEGER,
      allowed_types      TEXT
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS rate_limit_daily (
      key_id TEXT    NOT NULL,
      date   TEXT    NOT NULL,
      count  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (key_id, date)
    )
  `;

  // Lifetime usage counters per key, keyed by source (the key name jobs record).
  // Persistent: survives job deletion / queue clears.
  await sql`
    CREATE TABLE IF NOT EXISTS key_stats (
      source     TEXT    PRIMARY KEY,
      enqueued   INTEGER NOT NULL DEFAULT 0,
      printed    INTEGER NOT NULL DEFAULT 0,
      failed     INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::int
    )
  `;

  // Wall accounts — created only by the admin (no public signup). A logged-in
  // wall user has no message cooldown and a fixed display name.
  await sql`
    CREATE TABLE IF NOT EXISTS wall_users (
      username     TEXT NOT NULL PRIMARY KEY,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at   INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::int
    )
  `;
}

// Tests only: ensure schema exists, then wipe all rows for an isolated run.
export async function resetDbForTest(): Promise<void> {
  await migrate();
  await sql`TRUNCATE jobs, api_keys, rate_limit_daily, key_stats, wall_users`;
}

// ─── Wall accounts ──────────────────────────────────────────────────────────────

export interface WallUser {
  username:     string;
  display_name: string;
  created_at:   number;
}

export async function createWallUser(username: string, password: string, displayName: string): Promise<WallUser | null> {
  const hash = await Bun.password.hash(password);
  try {
    const [u] = await sql<WallUser[]>`
      INSERT INTO wall_users (username, password_hash, display_name)
      VALUES (${username}, ${hash}, ${displayName})
      RETURNING username, display_name, created_at
    `;
    return u ?? null;
  } catch {
    return null; // username already exists
  }
}

export async function verifyWallUser(username: string, password: string): Promise<WallUser | null> {
  const [row] = await sql<{ username: string; password_hash: string; display_name: string; created_at: number }[]>`
    SELECT username, password_hash, display_name, created_at FROM wall_users WHERE username = ${username}
  `;
  if (!row) return null;
  if (!(await Bun.password.verify(password, row.password_hash))) return null;
  return { username: row.username, display_name: row.display_name, created_at: row.created_at };
}

export async function listWallUsers(): Promise<WallUser[]> {
  return sql<WallUser[]>`SELECT username, display_name, created_at FROM wall_users ORDER BY created_at DESC`;
}

export async function deleteWallUser(username: string): Promise<boolean> {
  const rows = await sql`DELETE FROM wall_users WHERE username = ${username} RETURNING username`;
  return rows.length > 0;
}

// ─── Key usage stats ───────────────────────────────────────────────────────────

export interface KeyStats {
  source:     string;
  enqueued:   number;
  printed:    number;
  failed:     number;
  updated_at: number;
}

type StatField = "enqueued" | "printed" | "failed";

// Atomically bump one counter for a source, creating the row on first use.
// Column name is from a fixed union (safe to interpolate); source is parameterized.
export async function incrementKeyStat(source: string, field: StatField): Promise<void> {
  await sql.unsafe(
    `INSERT INTO key_stats (source, ${field}, updated_at)
     VALUES ($1, 1, EXTRACT(EPOCH FROM NOW())::int)
     ON CONFLICT (source) DO UPDATE
       SET ${field} = key_stats.${field} + 1, updated_at = EXTRACT(EPOCH FROM NOW())::int`,
    [source],
  );
}

export async function listKeyStats(): Promise<KeyStats[]> {
  return sql<KeyStats[]>`SELECT source, enqueued, printed, failed, updated_at FROM key_stats ORDER BY printed DESC`;
}

// ─── Job helpers ─────────────────────────────────────────────────────────────

export type JobStatus = "pending" | "printing" | "done" | "failed" | "cancelled";
export type JobType   = "text" | "ticket" | "todo" | "qr" | "barcode" | "image" | "borders" | "test";

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

export async function enqueueJob(type: JobType, payload: unknown, source: string): Promise<Job> {
  const id = crypto.randomUUID();
  const [job] = await sql<Job[]>`
    INSERT INTO jobs (id, type, payload, source)
    VALUES (${id}, ${type}, ${JSON.stringify(payload)}, ${source})
    RETURNING *
  `;
  return job!;
}

export async function getJob(id: string): Promise<Job | null> {
  const [job] = await sql<Job[]>`SELECT * FROM jobs WHERE id = ${id}`;
  return job ?? null;
}

export async function listJobs(status?: JobStatus): Promise<Job[]> {
  if (status) {
    return sql<Job[]>`SELECT * FROM jobs WHERE status = ${status} ORDER BY created_at ASC, seq ASC`;
  }
  return sql<Job[]>`SELECT * FROM jobs ORDER BY created_at DESC, seq DESC`;
}

export async function listPendingJobs(): Promise<Job[]> {
  return listJobs("pending");
}

export async function deleteJob(id: string): Promise<boolean> {
  const [job] = await sql<{ status: string }[]>`SELECT status FROM jobs WHERE id = ${id}`;
  if (!job || job.status === "printing") return false;
  await sql`DELETE FROM jobs WHERE id = ${id}`;
  return true;
}

export async function updateJobStatus(id: string, status: JobStatus, error?: string): Promise<void> {
  await sql`
    UPDATE jobs
    SET status = ${status}, error = ${error ?? null}, updated_at = EXTRACT(EPOCH FROM NOW())::int
    WHERE id = ${id}
  `;
}

export async function incrementRetry(id: string): Promise<number> {
  const [row] = await sql<{ retry_count: number }[]>`
    UPDATE jobs
    SET retry_count = retry_count + 1, updated_at = EXTRACT(EPOCH FROM NOW())::int
    WHERE id = ${id}
    RETURNING retry_count
  `;
  return row?.retry_count ?? 0;
}

export async function resetJobForRetry(id: string): Promise<void> {
  await sql`
    UPDATE jobs
    SET status = 'pending', retry_count = 0, error = NULL, updated_at = EXTRACT(EPOCH FROM NOW())::int
    WHERE id = ${id}
  `;
}

export async function resetStuckJobs(): Promise<number> {
  const rows = await sql`
    UPDATE jobs
    SET status = 'pending', updated_at = EXTRACT(EPOCH FROM NOW())::int
    WHERE status = 'printing'
    RETURNING id
  `;
  return rows.length;
}

// ─── API key helpers ──────────────────────────────────────────────────────────

export interface ApiKey {
  id:                 string;
  name:               string;
  hashed_key:         string;
  expires_at:         number | null;
  revoked_at:         number | null;
  created_at:         number;
  rate_limit_per_min: number | null;
  rate_limit_per_day: number | null;
  allowed_types:      string | null; // raw JSON string, null = all types allowed
}

async function hashKey(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}

export async function createApiKey(
  name: string,
  expiresAt?: number,
  rateLimitPerMin?: number | null,
  rateLimitPerDay?: number | null,
  allowedTypes?: string[] | null,
): Promise<{ key: ApiKey; raw: string }> {
  const id     = crypto.randomUUID();
  const raw    = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
  const hashed = await hashKey(raw);
  const typesJson = allowedTypes != null ? JSON.stringify(allowedTypes) : null;
  const [key] = await sql<ApiKey[]>`
    INSERT INTO api_keys (id, name, hashed_key, expires_at, rate_limit_per_min, rate_limit_per_day, allowed_types)
    VALUES (${id}, ${name}, ${hashed}, ${expiresAt ?? null}, ${rateLimitPerMin ?? null}, ${rateLimitPerDay ?? null}, ${typesJson})
    RETURNING *
  `;
  return { key: key!, raw };
}

export async function verifyApiKey(raw: string): Promise<ApiKey | null> {
  const hashed = await hashKey(raw);
  const [key] = await sql<ApiKey[]>`SELECT * FROM api_keys WHERE hashed_key = ${hashed}`;
  if (!key) return null;
  if (key.revoked_at !== null) return null;
  if (key.expires_at !== null && key.expires_at < Math.floor(Date.now() / 1000)) return null;
  return key;
}

type ApiKeyRow = Omit<ApiKey, "hashed_key"> & { enqueued: number; printed: number; failed: number };

export async function listApiKeys(): Promise<(Omit<ApiKeyRow, "allowed_types"> & { allowed_types: string[] | null })[]> {
  const rows = await sql<ApiKeyRow[]>`
    SELECT k.id, k.name, k.expires_at, k.revoked_at, k.created_at,
           k.rate_limit_per_min, k.rate_limit_per_day, k.allowed_types,
           COALESCE(s.enqueued, 0) AS enqueued,
           COALESCE(s.printed, 0)  AS printed,
           COALESCE(s.failed, 0)   AS failed
    FROM api_keys k
    LEFT JOIN key_stats s ON s.source = k.name
    ORDER BY k.created_at DESC, k.seq DESC
  `;
  return rows.map(r => ({
    ...r,
    allowed_types: r.allowed_types ? JSON.parse(r.allowed_types) as string[] : null,
  }));
}

export async function revokeApiKey(id: string): Promise<boolean> {
  const rows = await sql`
    UPDATE api_keys SET revoked_at = EXTRACT(EPOCH FROM NOW())::int
    WHERE id = ${id} AND revoked_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

export async function deleteApiKey(id: string): Promise<boolean> {
  const rows = await sql`DELETE FROM api_keys WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

export async function updateApiKey(
  id: string,
  fields: {
    expires_at?:         number | null;
    rate_limit_per_min?: number | null;
    rate_limit_per_day?: number | null;
    allowed_types?:      string[] | null;
  },
): Promise<boolean> {
  // Build SET clause dynamically — column names are hardcoded (safe), values are parameterized.
  const setClauses: string[] = [];
  const vals: (number | string | null)[] = [];

  function p(v: number | string | null): string {
    vals.push(v);
    return `$${vals.length}`;
  }

  if ("expires_at"         in fields) setClauses.push(`expires_at = ${p(fields.expires_at ?? null)}`);
  if ("rate_limit_per_min" in fields) setClauses.push(`rate_limit_per_min = ${p(fields.rate_limit_per_min ?? null)}`);
  if ("rate_limit_per_day" in fields) setClauses.push(`rate_limit_per_day = ${p(fields.rate_limit_per_day ?? null)}`);
  if ("allowed_types"      in fields) {
    setClauses.push(`allowed_types = ${p(fields.allowed_types != null ? JSON.stringify(fields.allowed_types) : null)}`);
  }

  if (setClauses.length === 0) return false;

  vals.push(id);
  const rows = await sql.unsafe(
    `UPDATE api_keys SET ${setClauses.join(", ")} WHERE id = $${vals.length} AND revoked_at IS NULL RETURNING id`,
    vals,
  );
  return rows.length > 0;
}
