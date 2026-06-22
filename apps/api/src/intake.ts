import { enqueue } from "./queue";
import {
  buildTextPayload, buildTicketPayload, buildQrPayload, buildImagePayload,
} from "@printer/core";
import type { Job } from "./db";
import type { PrintTextBody, PrintTicketBody, PrintQrBody, PrintImageBody, PrintTodoBody } from "./types";
import type { CardData } from "@printer/core";

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
  return { ok: true, job: await enqueue("image", buildImagePayload(b), source) };
}

export async function intakeTodo(body: unknown, source: string): Promise<IntakeResult> {
  const b = body as PrintTodoBody | null;
  if (!Array.isArray(b?.items) || b.items.length === 0) return reject("body.items must be a non-empty array");
  // All rows use the 3-col inline layout: [ ] | name | qty.
  // qty="" means no qty displayed but keeps consistent inline layout across all items.
  // name clamped to 50 chars (wraps gracefully); qty clamped to 8 chars (fits right column).
  const rows: [string, string, string][] = b.items
    .map(i => {
      if (Array.isArray(i)) {
        const name = String(i[0] ?? "").trim().slice(0, 50);
        const qty  = String(i[1] ?? "").trim().slice(0, 8);
        return name ? (["[ ]", name, qty] as [string, string, string]) : null;
      }
      const name = String(i).trim().slice(0, 50);
      return name ? (["[ ]", name, ""] as [string, string, string]) : null;
    })
    .filter(Boolean) as [string, string, string][];
  if (rows.length === 0) return reject("body.items must contain at least one non-empty string");
  const now = new Date();
  const dd  = String(now.getDate()).padStart(2, "0");
  const mm  = String(now.getMonth() + 1).padStart(2, "0");
  const yy  = String(now.getFullYear()).slice(2);
  const card: CardData = {
    label: b.title?.trim() || undefined,
    badge: b.badge?.trim() || undefined,
    date:  `${dd}/${mm}/${yy}`,
    rows,
  };
  return { ok: true, job: await enqueue("ticket", buildTicketPayload(card), source) };
}

export async function intakeMessage(
  body: unknown,
  source: string,
  customFromAllowed: boolean,
): Promise<IntakeResult> {
  const b = body as { message?: string; from?: string } | null;
  if (!b?.message?.trim()) return reject("body.message is required");
  const from = customFromAllowed && b.from?.trim() ? b.from.trim() : source;
  const now  = new Date();
  const hh   = String(now.getHours()).padStart(2, "0");
  const mm   = String(now.getMinutes()).padStart(2, "0");
  const card: CardData = { title: b.message.trim(), from, date: `${hh}:${mm}` };
  return { ok: true, job: await enqueue("ticket", buildTicketPayload(card), source) };
}
