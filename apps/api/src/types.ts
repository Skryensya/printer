import type { Priority, Status, BorderStyle } from "@printer/core";

export type Handler = (req: Request) => Response | Promise<Response>;

export interface PrintTextBody {
  text: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  size?: number; // 1–8
  invert?: boolean;
}

export interface PrintTicketBody {
  id: string;
  title: string;
  priority: Priority;
  status: Status;
  assignee?: string;
  due?: string;
  tags?: string[];
  style?: BorderStyle;
}

export interface PrintQrBody {
  text: string;
  size?: number;
  errorLevel?: "L" | "M" | "Q" | "H";
}

export interface PrintBarcodeBody {
  data: string;
  height?: number;
}

export interface PrintImageBody {
  image: string;    // base64-encoded
  mediaType?: string;
}
