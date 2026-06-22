import { createServerFn } from "@tanstack/react-start";
import { getRequestIP, getRequestHeader } from "@tanstack/react-start/server";

// ─── Public shapes (safe to ship to the client — no IPs, no secrets) ──────────

// A message the current visitor sent. No print status is exposed — to the
// sender it's simply "your message, which gets printed".
export interface WallItem {
  id:        string;
  message:   string;
  from:      string;
  createdAt: number;
}

export interface WallSnapshot {
  items:             WallItem[];   // ONLY the current visitor's own messages
  cooldownRemaining: number;       // ms left before this viewer can post again
  user:              string | null; // logged-in account name; null = anonymous
}

export interface SubmitInput {
  message:        string;
  from:           string;
  recaptchaToken: string;
  website:        string;  // honeypot — real users leave this empty
  elapsedMs:      number;  // time on the form — bots submit near-instantly
}

export type SubmitResult =
  | { ok: true;  id: string; cooldownRemaining: number }
  | { ok: false; error: string; cooldownRemaining?: number };

// ─── Request helpers (server-only; call only inside handlers) ─────────────────

function clientIp(): string {
  return (
    getRequestIP({ xForwardedFor: true }) ??
    getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

// ─── fetchWall ────────────────────────────────────────────────────────────────

export const fetchWallFn = createServerFn({ method: "GET" }).handler(async (): Promise<WallSnapshot> => {
  const { listQueueForIp, cooldownRemaining } = await import("./server/store");
  const { ensureDrain } = await import("./server/drain");
  const { currentUser } = await import("./session");
  ensureDrain();

  const ip   = clientIp();
  const user = await currentUser();

  return {
    items: listQueueForIp(ip).map(e => ({
      id:        e.id,
      message:   e.message,
      from:      e.from,
      createdAt: e.createdAt,
    })),
    // Logged-in accounts have no cooldown.
    cooldownRemaining: user ? 0 : cooldownRemaining(ip),
    user:              user?.name ?? null,
  };
});

// ─── submitMessage ──────────────────────────────────────────────────────────

export const submitMessageFn = createServerFn({ method: "POST" })
  .validator((data: SubmitInput) => data)
  .handler(async ({ data }): Promise<SubmitResult> => {
    const { config } = await import("./server/config");
    const { cooldownRemaining, recordSubmission, enqueue } = await import("./server/store");
    const { verifyRecaptcha } = await import("./server/recaptcha");
    const { ensureDrain } = await import("./server/drain");
    const { currentUser } = await import("./session");

    const ip   = clientIp();
    const user = await currentUser();

    // 1. Honeypot + timing trap. Skip for logged-in accounts (trusted).
    if (!user) {
      const looksLikeBot = data.website.trim() !== "" || data.elapsedMs < config.minFillMs;
      if (looksLikeBot) {
        recordSubmission(ip);
        return { ok: true, id: "dropped", cooldownRemaining: config.cooldownMs };
      }
    }

    // 2. Validate the message.
    const message = data.message.trim();
    if (!message) return { ok: false, error: "El mensaje no puede estar vacío" };
    if (message.length > config.maxMessageLen) {
      return { ok: false, error: `Máximo ${config.maxMessageLen} caracteres` };
    }
    // Logged-in: name is fixed to the account (can't be changed). Anon: free name.
    const from = user ? user.name : (data.from.trim() || "anon").slice(0, 24);

    // Logged-in accounts skip the cooldown and the captcha entirely.
    if (!user) {
      // 3. Per-IP cooldown.
      const remaining = cooldownRemaining(ip);
      if (remaining > 0) {
        return { ok: false, error: "Ya enviaste un mensaje hace poco", cooldownRemaining: remaining };
      }
      // 4. reCAPTCHA.
      const captcha = await verifyRecaptcha(data.recaptchaToken, ip);
      if (!captcha.ok) return { ok: false, error: captcha.reason ?? "Captcha falló" };
      recordSubmission(ip);
    }

    // 5. Enqueue and make sure the drainer is running.
    const entry = enqueue(message, from, ip);
    ensureDrain();

    return { ok: true, id: entry.id, cooldownRemaining: user ? 0 : config.cooldownMs };
  });
