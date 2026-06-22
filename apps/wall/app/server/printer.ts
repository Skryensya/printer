// Server-only client for the printer API. Sends a message as a `message` job
// and, crucially, reads the rate-limit headers off every response (including
// 429s) to update our local budget — this is how the wall learns "how much the
// API will still let it send".

import { config } from "./config";
import { setBudget } from "./store";

export interface SendResult {
  ok:     boolean;
  status: number;
  jobId:  string | null;
  error:  string | null;
}

function num(h: Headers, name: string): number | null {
  const v = h.get(name);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Translate the API's X-RateLimit-* headers into our Budget shape.
function ingestRateHeaders(h: Headers): void {
  const remainingMinute = num(h, "X-RateLimit-Remaining-Minute");
  const remainingDay    = num(h, "X-RateLimit-Remaining-Day");
  const resetMinuteSec  = num(h, "X-RateLimit-Reset-Minute");
  const resetDaySec     = num(h, "X-RateLimit-Reset-Day");

  setBudget({
    remainingMinute,
    remainingDay,
    ...(resetMinuteSec !== null ? { resetMinuteAt: resetMinuteSec * 1000 } : {}),
    ...(resetDaySec    !== null ? { resetDayAt:    resetDaySec * 1000 }    : {}),
  });
}

export async function sendMessage(message: string, from: string): Promise<SendResult> {
  if (!config.apiKey) {
    return { ok: false, status: 0, jobId: null, error: "WALL_API_KEY not configured" };
  }

  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}/api/v1/print/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key":    config.apiKey,
      },
      body: JSON.stringify({ message, from }),
    });
  } catch (e) {
    return { ok: false, status: 0, jobId: null, error: e instanceof Error ? e.message : "Network error" };
  }

  ingestRateHeaders(res.headers);

  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };

  if (res.ok) {
    return { ok: true, status: res.status, jobId: data.id ?? null, error: null };
  }
  return { ok: false, status: res.status, jobId: null, error: data.error ?? `HTTP ${res.status}` };
}
