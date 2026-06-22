import { cmd, line } from "./commands";
import { buildTicket, buildBorders } from "./tickets";
import { buildBarcode, type BarcodeFormat } from "./barcode";
import { buildImage, buildQRImage, buildBarcodeImage, buildCardTicket, type ImageEffect } from "./image";
import type { CardData } from "./card-ticket";

// ─── Canonical job type list ──────────────────────────────────────────────────
// Single source of truth. Import JOB_TYPES / JobType everywhere — don't redeclare.

export const JOB_TYPES = ["text","ticket","qr","barcode","image","borders","test"] as const;
export type JobType = typeof JOB_TYPES[number];

// ─── Payload shapes ───────────────────────────────────────────────────────────

export interface JobPayloadMap {
  text:    { v: number; text: string; align?: string; bold?: boolean; size?: number; invert?: boolean };
  ticket:  { v: number } & CardData;
  qr:      { v: number; text: string; size?: number; errorLevel?: "L" | "M" | "Q" | "H" };
  barcode: { v: number; data: string; height?: number; format?: BarcodeFormat };
  image:   { v: number; image: string; mediaType?: string; effect?: ImageEffect };
  borders: { v: number };
  test:    { v: number };
}

// ─── Payload constructors ─────────────────────────────────────────────────────
// Accept raw API body, apply defaults + clamping, return the stored payload shape.
// Keeps validation logic in core where it's testable without HTTP.

export function buildTextPayload(b: {
  text: string; align?: string; bold?: boolean; size?: number; invert?: boolean;
}): JobPayloadMap["text"] {
  return {
    v:      1,
    text:   b.text,
    align:  b.align ?? "left",
    bold:   b.bold ?? false,
    size:   Math.min(4, Math.max(1, b.size ?? 1)),
    invert: b.invert ?? false,
  };
}

export function buildTicketPayload(b: CardData): JobPayloadMap["ticket"] {
  return {
    v:     1,
    title: b.title,
    badge: b.badge,
    from:  b.from,
    label: b.label,
    date:  b.date,
    rows:  b.rows,
    qr:    b.qr,
  };
}

export function buildQrPayload(b: {
  text: string; size?: number; errorLevel?: string;
}): JobPayloadMap["qr"] {
  return {
    v:          1,
    text:       b.text,
    size:       Math.min(16, Math.max(1, b.size ?? 8)),
    errorLevel: (b.errorLevel ?? "M") as "L" | "M" | "Q" | "H",
  };
}

export function buildBarcodePayload(b: {
  data: string; height?: number; format?: string;
}): JobPayloadMap["barcode"] {
  return {
    v:      1,
    data:   b.data,
    height: Math.min(255, Math.max(1, b.height ?? 80)),
    format: (b.format ?? "code128") as BarcodeFormat,
  };
}

export function buildImagePayload(b: {
  image: string; mediaType?: string; effect?: string;
}): JobPayloadMap["image"] {
  return {
    v:         1,
    image:     b.image,
    mediaType: b.mediaType,
    effect:    (b.effect === "invert" ? "invert" : "photo") as ImageEffect,
  };
}

type PrintHandle = { send(...cmds: Uint8Array[]): Promise<void> };

// When a payload schema changes, increment v in the builder and add a migration
// branch here: if (b.v === undefined || b.v < 2) { /* migrate old shape */ }
export async function buildJobCommands(type: JobType, payload: unknown): Promise<Uint8Array[]> {
  switch (type) {
    case "text": {
      const b = payload as JobPayloadMap["text"];
      const align = b.align ?? "left";
      return [
        align === "center" ? cmd.alignCenter() : align === "right" ? cmd.alignRight() : cmd.alignLeft(),
        cmd.bold(b.bold ?? false),
        cmd.invert(b.invert ?? false),
        cmd.charSize(b.size ?? 1, b.size ?? 1),
        ...b.text.split("\n").map(l => line(l)),
        cmd.charSize(1, 1),
        cmd.bold(false),
        cmd.invert(false),
      ];
    }
    case "ticket": {
      const b = payload as JobPayloadMap["ticket"];
      const bands = await buildCardTicket(b);
      return [cmd.alignCenter(), ...bands];
    }
    case "qr": {
      const b = payload as JobPayloadMap["qr"];
      const bands = await buildQRImage(b.text);
      return [cmd.alignCenter(), ...bands];
    }
    case "barcode": {
      const b = payload as JobPayloadMap["barcode"];
      const bands = await buildBarcodeImage(b.data, b.height ?? 80, b.format ?? "code128");
      return [cmd.alignCenter(), ...bands];
    }
    case "image": {
      const b = payload as JobPayloadMap["image"];
      const chunks = await buildImage(Buffer.from(b.image, "base64"), b.effect ?? "photo");
      return [cmd.alignCenter(), ...chunks];
    }
    case "borders":
      return [cmd.alignLeft(), ...buildBorders()];
    case "test": {
      const testQr = await buildQRImage("https://github.com");
      return [
        cmd.alignCenter(), cmd.bold(true), cmd.invert(true),
        line("     TEST PAGE      "),
        cmd.invert(false), cmd.bold(false), line(""),
        cmd.alignLeft(), line("-- QR Code --"), cmd.alignCenter(),
        ...testQr, line(""),
        line("-- Code128 Barcode --"), ...buildBarcode("PRINTER-TEST"), line(""),
        cmd.alignLeft(), line("-- Borders --"), ...buildBorders(), line(""),
        line("-- Ticket --"),
        ...buildTicket({
          id: "042", title: "Fix auth bug on Safari",
          priority: "HIGH", status: "IN PROGRESS",
          assignee: "Allison", due: "2026-06-20", tags: ["auth", "bug"],
        }, "thin"),
      ];
    }
  }
}

export async function executeJob(type: JobType, payload: unknown, p: PrintHandle): Promise<void> {
  await p.send(...await buildJobCommands(type, payload));
}
