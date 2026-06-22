import { sql } from "bun";
import type { ApiKey } from "./db";

// ─── Public interface ─────────────────────────────────────────────────────────

export interface QuotaResult {
  allowed:    boolean;
  exceeded:   "minute" | "day" | null;
  retryAfter: number;
  headers(): Record<string, string>;
  attachHeaders(response: Response): Response;
}

// ─── Internal state shape ─────────────────────────────────────────────────────

interface QuotaState {
  limitMinute:     number | null;
  remainingMinute: number | null;
  resetMinute:     number;
  limitDay:        number | null;
  remainingDay:    number | null;
  resetDay:        number;
}

function buildHeaders(s: QuotaState): Record<string, string> {
  const h: Record<string, string> = {
    "X-RateLimit-Reset-Minute": String(s.resetMinute),
    "X-RateLimit-Reset-Day":    String(s.resetDay),
  };
  if (s.limitMinute !== null) {
    h["X-RateLimit-Limit-Minute"]     = String(s.limitMinute);
    h["X-RateLimit-Remaining-Minute"] = String(s.remainingMinute ?? 0);
  }
  if (s.limitDay !== null) {
    h["X-RateLimit-Limit-Day"]     = String(s.limitDay);
    h["X-RateLimit-Remaining-Day"] = String(s.remainingDay ?? 0);
  }
  return h;
}

function makeResult(
  allowed: boolean,
  exceeded: "minute" | "day" | null,
  retryAfter: number,
  state: QuotaState,
): QuotaResult {
  return {
    allowed,
    exceeded,
    retryAfter,
    headers: () => buildHeaders(state),
    attachHeaders: (response: Response) => {
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(buildHeaders(state))) headers.set(k, v);
      return new Response(response.body, {
        status:     response.status,
        statusText: response.statusText,
        headers,
      });
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function utcDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function nextMidnightUtc(now: number): number {
  const d = new Date(now);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000);
}

// ─── MinuteWindow ─────────────────────────────────────────────────────────────
// Sliding 60-second window, in-memory only. Losing it on restart costs at most
// 60s of under-counting — acceptable for a per-minute cap.

interface MinuteCheck { used: number; resetAt: number; }

const _minuteStore = new Map<string, number[]>();

const MinuteWindow = {
  check(keyId: string, now: number): MinuteCheck {
    const active = (_minuteStore.get(keyId) ?? []).filter(t => t > now - 60_000);
    const resetAt = active.length > 0
      ? Math.ceil((active[0]! + 60_000) / 1000)
      : Math.floor(now / 1000) + 60;
    return { used: active.length, resetAt };
  },

  commit(keyId: string, now: number): void {
    const active = (_minuteStore.get(keyId) ?? []).filter(t => t > now - 60_000);
    active.push(now);
    _minuteStore.set(keyId, active);
  },

  reset(): void { _minuteStore.clear(); },
};

// ─── DayWindow ────────────────────────────────────────────────────────────────
// Fixed UTC calendar day backed by Postgres so daily caps survive restarts.

interface DayCheck { used: number; }

const DayWindow = {
  async check(keyId: string, date: string): Promise<DayCheck> {
    const [row] = await sql<{ count: number }[]>`
      SELECT count FROM rate_limit_daily WHERE key_id = ${keyId} AND date = ${date}
    `;
    return { used: row?.count ?? 0 };
  },

  async commit(keyId: string, date: string): Promise<void> {
    await sql`
      INSERT INTO rate_limit_daily (key_id, date, count) VALUES (${keyId}, ${date}, 1)
      ON CONFLICT (key_id, date) DO UPDATE SET count = rate_limit_daily.count + 1
    `;
  },
};

// ─── Quota check ─────────────────────────────────────────────────────────────

export async function checkQuota(key: ApiKey): Promise<QuotaResult> {
  const now      = Date.now();
  const nowSec   = Math.floor(now / 1000);
  const date     = utcDate(now);
  const resetDay = nextMidnightUtc(now);

  const limitMin = key.rate_limit_per_min ?? null;
  const limitDay = key.rate_limit_per_day ?? null;

  const minute = limitMin !== null ? MinuteWindow.check(key.id, now) : null;
  const day    = limitDay !== null ? await DayWindow.check(key.id, date) : null;

  const remainingMinute = minute !== null ? Math.max(0, limitMin! - minute.used) : null;
  const remainingDay    = day    !== null ? Math.max(0, limitDay! - day.used)    : null;
  const resetMinute     = minute?.resetAt ?? nowSec + 60;

  if (minute !== null && minute.used >= limitMin!) {
    return makeResult(false, "minute", Math.max(1, resetMinute - nowSec), {
      limitMinute: limitMin, remainingMinute: 0,     resetMinute,
      limitDay,              remainingDay,             resetDay,
    });
  }

  if (day !== null && day.used >= limitDay!) {
    return makeResult(false, "day", Math.max(1, resetDay - nowSec), {
      limitMinute: limitMin, remainingMinute, resetMinute,
      limitDay,              remainingDay: 0, resetDay,
    });
  }

  if (minute !== null) MinuteWindow.commit(key.id, now);
  if (day    !== null) await DayWindow.commit(key.id, date);

  const committedMinuteRemaining = limitMin !== null
    ? Math.max(0, limitMin - (minute!.used + 1))
    : null;
  const committedDayRemaining = limitDay !== null
    ? Math.max(0, limitDay - (day!.used + 1))
    : null;
  const committedMinuteReset = minute !== null
    ? MinuteWindow.check(key.id, now).resetAt
    : nowSec + 60;

  return makeResult(true, null, 0, {
    limitMinute: limitMin, remainingMinute: committedMinuteRemaining, resetMinute: committedMinuteReset,
    limitDay,              remainingDay:    committedDayRemaining,    resetDay,
  });
}

export function resetMinuteWindows(): void { MinuteWindow.reset(); }
