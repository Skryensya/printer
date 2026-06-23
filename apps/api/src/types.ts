import type { ImageEffect, CardData } from "@printer/core";

export type Handler = (req: Request) => Response | Promise<Response>;

export interface PrintTextBody {
  text: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  size?: number; // 1–4
  invert?: boolean;
}

export type PrintTicketBody = CardData;

export interface PrintQrBody {
  text: string;
  size?: number; // 1–16
  errorLevel?: "L" | "M" | "Q" | "H";
}

export interface PrintImageBody {
  image: string;
  mediaType?: string;
  effect?: ImageEffect;
  // Optional full-resolution source to archive instead of the print bitmap.
  // Archived only (R2); never stored in the job payload.
  original?: string;
  originalMediaType?: string;
}

export interface PrintTodoBody {
  // string = item name (≤50 chars); [name, qty] = with right-aligned unit (qty ≤8 chars)
  items: (string | [name: string, qty: string])[];
  title?: string;
  badge?: string;
}
