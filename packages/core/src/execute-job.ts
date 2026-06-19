import { cmd, line } from "./commands";
import { buildTicket, buildBorders } from "./tickets";
import { buildQR } from "./qr";
import { buildBarcode } from "./barcode";
import { buildImage } from "./image";
import type { Task, BorderStyle } from "./tickets";

export type JobType = "text" | "ticket" | "qr" | "barcode" | "image" | "borders" | "test";

export interface JobPayloadMap {
  text:    { text: string; align?: string; bold?: boolean; size?: number; invert?: boolean };
  ticket:  Task & { style?: BorderStyle };
  qr:      { text: string; size?: number; errorLevel?: "L" | "M" | "Q" | "H" };
  barcode: { data: string; height?: number };
  image:   { image: string; mediaType?: string };
  borders: Record<string, never>;
  test:    Record<string, never>;
}

type PrintHandle = { send(...cmds: Uint8Array[]): Promise<void> };

export async function executeJob(type: JobType, payload: unknown, p: PrintHandle): Promise<void> {
  switch (type) {
    case "text": {
      const b = payload as JobPayloadMap["text"];
      const align = b.align ?? "left";
      await p.send(
        align === "center" ? cmd.alignCenter() : align === "right" ? cmd.alignRight() : cmd.alignLeft(),
        cmd.bold(b.bold ?? false),
        cmd.invert(b.invert ?? false),
        cmd.charSize(b.size ?? 1, b.size ?? 1),
        ...b.text.split("\n").map(l => line(l)),
        cmd.charSize(1, 1),
        cmd.bold(false),
        cmd.invert(false),
      );
      break;
    }
    case "ticket": {
      const b = payload as JobPayloadMap["ticket"];
      await p.send(cmd.alignLeft(), ...buildTicket(b, b.style ?? "thin"));
      break;
    }
    case "qr": {
      const b = payload as JobPayloadMap["qr"];
      await p.send(cmd.alignCenter(), ...buildQR(b.text, b.size ?? 8, b.errorLevel ?? "M"));
      break;
    }
    case "barcode": {
      const b = payload as JobPayloadMap["barcode"];
      await p.send(cmd.alignCenter(), ...buildBarcode(b.data, b.height ?? 80));
      break;
    }
    case "image": {
      const b = payload as JobPayloadMap["image"];
      const chunks = await buildImage(Buffer.from(b.image, "base64"));
      await p.send(cmd.alignCenter(), ...chunks);
      break;
    }
    case "borders": {
      await p.send(cmd.alignLeft(), ...buildBorders());
      break;
    }
    case "test": {
      await p.send(
        cmd.alignCenter(), cmd.bold(true), cmd.invert(true),
        line("     TEST PAGE      "),
        cmd.invert(false), cmd.bold(false), line(""),
        cmd.alignLeft(), line("-- QR Code --"), cmd.alignCenter(),
        ...buildQR("https://github.com", 8), line(""),
        line("-- Code128 Barcode --"), ...buildBarcode("PRINTER-TEST"), line(""),
        cmd.alignLeft(), line("-- Borders --"), ...buildBorders(), line(""),
        line("-- Ticket --"),
        ...buildTicket({
          id: "042", title: "Fix auth bug on Safari",
          priority: "HIGH", status: "IN PROGRESS",
          assignee: "Allison", due: "2026-06-20", tags: ["auth", "bug"],
        }, "thin"),
      );
      break;
    }
  }
}
