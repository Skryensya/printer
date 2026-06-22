// Server-only background worker. Drains the queue to the printer API, sending
// only as many messages as the API's rate-limit headers permit. When the
// budget is exhausted it idles until the reset time we read from the headers.
//
// Started lazily and idempotently via ensureDrain(), which is called from the
// server function handlers — so it only ever runs on the long-lived node server.

import { config } from "./config";
import { sendMessage } from "./printer";
import { nextPending, updateEntry, budgetExhausted, clearCooldown } from "./store";

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
    const result = await sendMessage(entry.message, entry.from);

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
}
