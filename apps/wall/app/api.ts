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
  hasImage:  boolean;
}

export interface WallSnapshot {
  items:             WallItem[];   // ONLY the current visitor's own messages
  cooldownRemaining: number;       // ms left before this viewer can post again
  user:              string | null; // logged-in account name; null = anonymous
  anonPaused:        boolean;      // anon submissions are currently blocked for this visitor
  cooldownMs:        number;       // current per-IP cooldown window (for the idle hint)
}

export interface SubmitInput {
  message:        string;
  from:           string;
  recaptchaToken: string;
  website:        string;  // honeypot — real users leave this empty
  elapsedMs:      number;  // time on the form — bots submit near-instantly
  // Optional photo (logged-in accounts only). `data` = 384px print bitmap;
  // `original` = the full-res file, archived (not printed).
  image?:         { data: string; mediaType: string; original?: string; originalMediaType?: string } | null;
}

export type SubmitResult =
  | { ok: true;  id: string; cooldownRemaining: number }
  | { ok: false; error: string; cooldownRemaining?: number; unavailable?: boolean };

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
  const { listQueueForIp, listQueueForUser, cooldownRemaining, anonAllowed, cooldownWindowMs } = await import("./server/store");
  const { ensureDrain } = await import("./server/drain");
  const { currentUser } = await import("./server/auth");
  ensureDrain();

  const ip   = clientIp();
  const user = await currentUser();

  // Logged in → your account's messages (across devices); anon → this IP's.
  const items = user ? listQueueForUser(user.username) : listQueueForIp(ip);

  return {
    items: items.map(e => ({
      id:        e.id,
      message:   e.message,
      from:      e.from,
      createdAt: e.createdAt,
      hasImage:  e.hasImage,
    })),
    // Logged-in accounts have no cooldown.
    cooldownRemaining: user ? 0 : cooldownRemaining(ip),
    user:              user?.name ?? null,
    // Logged-in accounts are never paused; anon is paused if globally blocked
    // or this IP is on the blocklist.
    anonPaused:        !user && !anonAllowed(ip),
    cooldownMs:        cooldownWindowMs(),
  };
});

// ─── fetchPhoto ───────────────────────────────────────────────────────────────
// Returns the print bitmap for one of the viewer's OWN pings, as a data URL.
// Ownership is enforced server-side: account pings are visible only to that
// account; anonymous pings only to the same IP. Returns null otherwise.

export const fetchPhotoFn = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<{ src: string } | null> => {
    const { getEntry, getStoredPhoto } = await import("./server/store");
    const { getJobImageUrl } = await import("./server/printer");
    const { currentUser } = await import("./server/auth");

    const entry = getEntry(data.id);
    if (!entry || !entry.hasImage) return null;

    const user = await currentUser();
    const owns = entry.username
      ? !!user && user.username === entry.username
      : entry.ip === clientIp();
    if (!owns) return null;

    // Prefer the R2 archive (full-res original). Falls back to the local 384px
    // thumbnail while the upload is still in flight, or when R2 is off (dev).
    if (entry.imageJobId) {
      const url = await getJobImageUrl(entry.imageJobId);
      if (url) return { src: url };
    }
    const b64 = getStoredPhoto(data.id);
    return b64 ? { src: `data:image/png;base64,${b64}` } : null;
  });

// ─── hidePing ─────────────────────────────────────────────────────────────────
// Removes a ping from the owner's history view only. The entry stays queued (so
// it still prints) and the printer API job + R2 archive are untouched — admin
// keeps the full record. Owner-scoped like fetchPhoto.

export const hidePingFn = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { getEntry, hideEntry } = await import("./server/store");
    const { currentUser } = await import("./server/auth");

    const entry = getEntry(data.id);
    if (!entry) return { ok: false };

    const user = await currentUser();
    const owns = entry.username
      ? !!user && user.username === entry.username
      : entry.ip === clientIp();
    if (!owns) return { ok: false };

    hideEntry(data.id);
    return { ok: true };
  });

// ─── submitMessage ──────────────────────────────────────────────────────────

export const submitMessageFn = createServerFn({ method: "POST" })
  .validator((data: SubmitInput) => data)
  .handler(async ({ data }): Promise<SubmitResult> => {
    const { config } = await import("./server/config");
    const { cooldownRemaining, recordSubmission, enqueue, anonAllowed, cooldownWindowMs } = await import("./server/store");
    const { verifyRecaptcha } = await import("./server/recaptcha");
    const { ensureDrain } = await import("./server/drain");
    const { currentUser } = await import("./server/auth");

    const ip   = clientIp();
    const user = await currentUser();

    // 0. Anti-abuse gate: anon submissions can be paused globally or per-IP from
    // print-admin. Logged-in accounts pass through. `unavailable` tells the
    // client to show the calm "temporarily paused" notice, not an error.
    if (!user && !anonAllowed(ip)) {
      return { ok: false, error: "Anonymous pings are paused right now", unavailable: true };
    }

    // 1. Honeypot + timing trap. Skip for logged-in accounts (trusted).
    if (!user) {
      const looksLikeBot = data.website.trim() !== "" || data.elapsedMs < config.minFillMs;
      if (looksLikeBot) {
        recordSubmission(ip);
        return { ok: true, id: "dropped", cooldownRemaining: cooldownWindowMs() };
      }
    }

    // 2. Validate. Photos are a logged-in-only perk; cap the payloads.
    const message = data.message.trim();
    let image: { data: string; mediaType: string; original?: string; originalMediaType?: string } | null = null;
    if (user && data.image?.data) {
      if (data.image.data.length > 1_500_000) {
        return { ok: false, error: "La imagen es muy grande" };
      }
      // The full-res original is archived only; allow it to be larger.
      const original = data.image.original && data.image.original.length <= 12_000_000 ? data.image.original : undefined;
      image = {
        data: data.image.data, mediaType: data.image.mediaType || "image/png",
        original, originalMediaType: data.image.originalMediaType || "image/png",
      };
    }
    // A logged-in user may send just a photo; otherwise text is required.
    if (!message && !image) return { ok: false, error: "El mensaje no puede estar vacío" };
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

    // 5. Enqueue (tagged with the account if logged in) and run the drainer.
    const entry = enqueue(message, from, ip, user?.username ?? null, image);
    ensureDrain();

    return { ok: true, id: entry.id, cooldownRemaining: user ? 0 : cooldownWindowMs() };
  });
