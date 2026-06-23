import { enqueue } from "./queue";
import {
  buildTextPayload, buildTicketPayload, buildTodoPayload, buildQrPayload, buildImagePayload, santiagoTime,
} from "@printer/core";
import { setJobImageUrl, type Job } from "./db";
import type { PrintTextBody, PrintTicketBody, PrintQrBody, PrintImageBody, PrintTodoBody } from "./types";
import type { CardData } from "@printer/core";
import { archiveImage } from "./storage";

// ─── Result type ──────────────────────────────────────────────────────────────
// A validated, enqueued Job on success; a ready-to-return 4xx Response on failure.
// Handlers call intake and immediately return result.response on failure.

export type IntakeResult =
  | { ok: true;  job: Job }
  | { ok: false; response: Response };

function reject(error: string, status = 400): IntakeResult {
  return { ok: false, response: Response.json({ error }, { status }) };
}

// ─── Per-type intake functions ────────────────────────────────────────────────
// Each function validates the raw body, rejects with a typed 400 for out-of-range
// inputs (rather than silently clamping), builds the stored payload, and enqueues.
// The handler is reduced to: parse body → call intake → return 202 or result.response.

export async function intakeText(body: unknown, source: string): Promise<IntakeResult> {
  const b = body as PrintTextBody | null;
  if (!b?.text) return reject("body.text is required");
  if (b.size !== undefined && (b.size < 1 || b.size > 4)) return reject("size must be 1–4");
  return { ok: true, job: await enqueue("text", buildTextPayload(b), source) };
}

export async function intakeTicket(body: unknown, source: string): Promise<IntakeResult> {
  const b = body as PrintTicketBody | null;
  if (!b || (!b.title && !b.qr && !(b.rows?.length))) return reject("body.title, body.qr, or body.rows is required");
  return { ok: true, job: await enqueue("ticket", buildTicketPayload(b), source) };
}

export async function intakeQr(body: unknown, source: string): Promise<IntakeResult> {
  const b = body as PrintQrBody | null;
  if (!b?.text) return reject("body.text is required");
  if (b.size !== undefined && (b.size < 1 || b.size > 16)) return reject("size must be 1–16");
  return { ok: true, job: await enqueue("qr", buildQrPayload(b), source) };
}

export async function intakeImage(body: unknown, source: string): Promise<IntakeResult> {
  const b = body as PrintImageBody | null;
  if (!b?.image) return reject("body.image (base64) is required");
  try { Buffer.from(b.image, "base64"); }
  catch { return reject("body.image must be valid base64"); }
  const job = await enqueue("image", buildImagePayload(b), source);
  // Archive the full-res original if the caller sent one, else the print bitmap.
  // R2 in prod, no-op in dev. Fire-and-forget — never blocks the print. When the
  // upload finishes, attach the public URL to the job (shows in the admin queue).
  const archiveData = b.original ?? b.image;
  const archiveType = b.original ? (b.originalMediaType ?? "image/png") : (b.mediaType ?? "image/png");
  void archiveImage(archiveData, archiveType, source).then(url => {
    if (url) return setJobImageUrl(job.id, url);
  }).catch(() => {});
  return { ok: true, job };
}

export async function intakeTodo(body: unknown, source: string): Promise<IntakeResult> {
  const b = body as PrintTodoBody | null;
  if (!Array.isArray(b?.items) || b.items.length === 0) return reject("body.items must be a non-empty array");
  // buildTodoPayload normalizes + clamps (name ≤50, qty ≤8) and drops empties.
  const payload = buildTodoPayload({ items: b.items, title: b.title, badge: b.badge });
  if (payload.items.length === 0) return reject("body.items must contain at least one non-empty item");
  // Stored as its own "todo" job type — renders as a card, replicable as POST /print/todo.
  return { ok: true, job: await enqueue("todo", payload, source) };
}

export async function intakeMessage(
  body: unknown,
  source: string,
  customFromAllowed: boolean,
): Promise<IntakeResult> {
  const b = body as { message?: string; from?: string } | null;
  if (!b?.message?.trim()) return reject("body.message is required");
  const from = customFromAllowed && b.from?.trim() ? b.from.trim() : source;
  const card: CardData = { title: b.message.trim(), from, date: santiagoTime() };
  return { ok: true, job: await enqueue("ticket", buildTicketPayload(card), source) };
}
