import { createServerFn } from "@tanstack/react-start";
import { getRequestIP, getRequestHeader } from "@tanstack/react-start/server";

// ─── Public shapes (safe to ship to the client — no IPs, no secrets) ──────────

export type EntryStatus = "pending" | "printing" | "printed" | "failed";

export interface WallItem {
  id:        string;
  message:   string;
  from:      string;
  status:    EntryStatus;
  createdAt: number;
  printedAt: number | null;
}

export interface WallSnapshot {
  items:             WallItem[];
  pending:           number;
  cooldownRemaining: number;       // ms left before this viewer can post again
  budget: {
    remainingMinute: number | null;
    remainingDay:    number | null;
  };
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
  const { listQueue, pendingCount, getBudget, cooldownRemaining } = await import("./server/store");
  const { ensureDrain } = await import("./server/drain");
  ensureDrain();

  const ip = clientIp();
  const budget = getBudget();

  return {
    items: listQueue().map(e => ({
      id:        e.id,
      message:   e.message,
      from:      e.from,
      status:    e.status,
      createdAt: e.createdAt,
      printedAt: e.printedAt,
    })),
    pending:           pendingCount(),
    cooldownRemaining: cooldownRemaining(ip),
    budget:            { remainingMinute: budget.remainingMinute, remainingDay: budget.remainingDay },
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

    const ip = clientIp();

    // 1. Honeypot + timing trap. Silently accept-but-drop so bots get no signal,
    //    and burn the IP's cooldown so it can't immediately retry.
    const looksLikeBot = data.website.trim() !== "" || data.elapsedMs < config.minFillMs;
    if (looksLikeBot) {
      recordSubmission(ip);
      return { ok: true, id: "dropped", cooldownRemaining: config.cooldownMs };
    }

    // 2. Validate the message.
    const message = data.message.trim();
    if (!message) return { ok: false, error: "Message can't be empty" };
    if (message.length > config.maxMessageLen) {
      return { ok: false, error: `Message must be ${config.maxMessageLen} characters or fewer` };
    }
    const from = (data.from.trim() || "anon").slice(0, 24);

    // 3. Per-IP cooldown — no second message from the same IP for 30 minutes.
    const remaining = cooldownRemaining(ip);
    if (remaining > 0) {
      return { ok: false, error: "You've already sent a message recently", cooldownRemaining: remaining };
    }

    // 4. reCAPTCHA.
    const captcha = await verifyRecaptcha(data.recaptchaToken, ip);
    if (!captcha.ok) return { ok: false, error: captcha.reason ?? "Captcha failed" };

    // 5. Accept: start the cooldown, enqueue, and make sure the drainer is running.
    recordSubmission(ip);
    const entry = enqueue(message, from, ip);
    ensureDrain();

    return { ok: true, id: entry.id, cooldownRemaining: config.cooldownMs };
  });
