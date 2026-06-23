// Server-only background worker. Drains the queue to the printer API, sending
// only as many messages as the API's rate-limit headers permit. When the
// budget is exhausted it idles until the reset time we read from the headers.
//
// Started lazily and idempotently via ensureDrain(), which is called from the
// server function handlers — so it only ever runs on the long-lived node server.

import { config } from "./config";
import { sendMessage, sendImage } from "./printer";
import { nextPending, updateEntry, budgetExhausted, clearCooldown, getImage, dropImage, ensurePhotoSweep } from "./store";

let started = false;
let draining = false;

async function tick(): Promise<void> {
  if (draining) return;          // never overlap sends
  if (budgetExhausted()) return; // headers say we have no room right now

  const entry = nextPending();
  if (!entry) return;

  draining = true;
  try {
    updateEntry(entry.id, { status: "printing" });

    // Print the message (if any), then the attached photo (if any). A logged-in
    // user may send a photo with no text, so the message step is optional.
    let result = { ok: true, status: 200, jobId: null as string | null, error: null as string | null };
    if (entry.message.trim()) {
      result = await sendMessage(entry.message, entry.from);
    }

    if (result.ok) {
      const img = entry.hasImage ? getImage(entry.id) : undefined;
      if (img) {
        result = await sendImage(img.data, img.mediaType, img.original, img.originalMediaType);
        if (result.ok) {
          // Remember the image job so we can read its R2 url later.
          if (result.jobId) updateEntry(entry.id, { imageJobId: result.jobId });
          dropImage(entry.id);
        }
      }
    }

    if (result.ok) {
      updateEntry(entry.id, { status: "printed", jobId: result.jobId, printedAt: Date.now() });
    } else if (result.status === 429) {
      // Rate-limited: budget was just refreshed from the headers. Put it back
      // and let the next tick wait until the reset window.
      updateEntry(entry.id, { status: "pending" });
    } else {
      // Genuine failure — release the visitor's cooldown so they can retry.
      updateEntry(entry.id, { status: "failed", error: result.error });
      clearCooldown(entry.ip);
    }
  } catch (e) {
    updateEntry(entry.id, { status: "failed", error: e instanceof Error ? e.message : "drain error" });
    clearCooldown(entry.ip);
  } finally {
    draining = false;
  }
}

export function ensureDrain(): void {
  if (started) return;
  started = true;
  setInterval(() => { void tick(); }, config.drainIntervalMs);
  ensurePhotoSweep(); // expire local thumbnail fallbacks once R2 has them
}
