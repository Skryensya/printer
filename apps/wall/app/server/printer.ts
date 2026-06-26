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

// Read a print job's archived-image URL (set by the API after the R2 upload).
// The wall key is source-scoped, so it can only read its own jobs. Null until
// the upload finishes, or if R2 isn't configured.
export async function getJobImageUrl(jobId: string): Promise<string | null> {
  if (!config.apiKey) return null;
  try {
    const res = await fetch(`${config.apiUrl}/api/v1/jobs/${jobId}`, {
      headers: { "X-API-Key": config.apiKey },
    });
    if (!res.ok) return null;
    const body = await res.json() as { job?: { image_url?: string | null } };
    return body.job?.image_url ?? null;
  } catch {
    return null;
  }
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

export async function sendMessage(
  message: string, from: string,
  senderIp?: string, senderAccount?: string | null,
  header?: string,
): Promise<SendResult> {
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
      // Relay the real end user so the API can attribute the job (the request
      // IP it sees is the wall's, not the sender's). sender_account = login
      // name when signed in; null/omitted = anonymous.
      body: JSON.stringify({ message, from, sender_ip: senderIp, sender_account: senderAccount, header }),
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

export async function sendImage(
  image: string, mediaType: string,
  original?: string, originalMediaType?: string,
): Promise<SendResult> {
  if (!config.apiKey) {
    return { ok: false, status: 0, jobId: null, error: "WALL_API_KEY not configured" };
  }
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}/api/v1/print/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey },
      body: JSON.stringify({ image, mediaType, effect: "photo", original, originalMediaType }),
    });
  } catch (e) {
    return { ok: false, status: 0, jobId: null, error: e instanceof Error ? e.message : "Network error" };
  }
  ingestRateHeaders(res.headers);
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (res.ok) return { ok: true, status: res.status, jobId: data.id ?? null, error: null };
  return { ok: false, status: res.status, jobId: null, error: data.error ?? `HTTP ${res.status}` };
}
