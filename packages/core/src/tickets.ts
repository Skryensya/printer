import { line437 } from "./encode437";

const W = 32;

export type Priority   = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type Status     = "TODO" | "IN PROGRESS" | "DONE" | "BLOCKED";
export type TicketTemplate = "task" | "label" | "receipt" | "badge" | "note" | "card";

export interface Task {
  id:        string;
  title:     string;
  priority:  Priority;
  status:    Status;
  assignee?: string;
  due?:      string;
  tags?:     string[];
}

export const borders = {
  ascii:  { tl:"+", tr:"+", bl:"+", br:"+", h:"-",  v:"|",  ml:"+", mr:"+", mh:"-"  },
  thin:   { tl:"┌", tr:"┐", bl:"└", br:"┘", h:"─",  v:"│",  ml:"├", mr:"┤", mh:"─"  },
  double: { tl:"╔", tr:"╗", bl:"╚", br:"╝", h:"═",  v:"║",  ml:"╠", mr:"╣", mh:"═"  },
  block:  { tl:"█", tr:"█", bl:"█", br:"█", h:"▄",  v:"█",  ml:"█", mr:"█", mh:"▄"  },
  shade:  { tl:"░", tr:"░", bl:"░", br:"░", h:"░",  v:"░",  ml:"░", mr:"░", mh:"░"  },
  stars:  { tl:"*", tr:"*", bl:"*", br:"*", h:"*",  v:"*",  ml:"*", mr:"*", mh:"*"  },
} as const;

export type BorderStyle = keyof typeof borders;
type Border = typeof borders[BorderStyle];

const PRI: Record<Priority, string> = {
  LOW:      "LOW",
  MEDIUM:   "MEDIUM",
  HIGH:     "HIGH",
  CRITICAL: "CRITICAL",
};

const STA: Record<Status, string> = {
  "TODO":        "TODO",
  "IN PROGRESS": "IN PROGRESS",
  "DONE":        "DONE",
  "BLOCKED":     "BLOCKED",
};

const PRI_BADGE: Record<Priority, string> = {
  LOW:      "[ LOW      ]",
  MEDIUM:   "[ MEDIUM   ]",
  HIGH:     "[ HIGH     ]",
  CRITICAL: "[!CRITICAL!]",
};

const STA_BADGE: Record<Status, string> = {
  "TODO":        "( ) TODO",
  "IN PROGRESS": "(~) IN PROGRESS",
  "DONE":        "(*) DONE",
  "BLOCKED":     "(X) BLOCKED",
};

function pad(text: string, w: number, align: "l"|"c"|"r" = "l"): string {
  const t = text.slice(0, w);
  const gap = w - t.length;
  if (align === "c") { const l = Math.floor(gap / 2); return " ".repeat(l) + t + " ".repeat(gap - l); }
  if (align === "r") return " ".repeat(gap) + t;
  return t + " ".repeat(gap);
}

function wrap(text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const word = w.slice(0, maxW);
    if (!cur) { cur = word; }
    else if (cur.length + 1 + word.length <= maxW) { cur += " " + word; }
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function divider(char = "─", w = W): string {
  return char.repeat(w);
}

// ─── TASK — original bordered ticket ─────────────────────────────────────────

export function renderTask(task: Task, style: BorderStyle = "thin"): string {
  const b = borders[style];
  const inner = W - 2;
  const row  = (t: string) => b.v + pad(t, inner) + b.v;
  const rowC = (t: string) => b.v + pad(t, inner, "c") + b.v;
  const titleLines = wrap(task.title, inner - 1);
  return [
    b.tl + b.h.repeat(inner) + b.tr,
    rowC(`TASK #${task.id}`),
    b.ml + b.mh.repeat(inner) + b.mr,
    ...titleLines.map(t => row(` ${t}`)),
    b.ml + b.mh.repeat(inner) + b.mr,
    row(` PRI ${PRI_BADGE[task.priority]}`),
    row(` STA ${STA_BADGE[task.status]}`),
    ...(task.assignee ? [row(` WHO ${task.assignee}`)] : []),
    ...(task.due      ? [row(` DUE ${task.due}`)]      : []),
    ...(task.tags?.length ? [row(` TAG ${task.tags.join(" ")}`)] : []),
    b.bl + b.h.repeat(inner) + b.br,
  ].join("\n");
}

// ─── LABEL — compact shipping/item label ─────────────────────────────────────

export function renderLabel(task: Task): string {
  const titleLines = wrap(task.title.toUpperCase(), W);
  const id = `#${task.id}`.padStart(W, " ");
  return [
    divider("━"),
    ...titleLines.map(t => pad(t, W, "c")),
    "",
    pad(`${PRI[task.priority]}  ${STA[task.status]}`, W),
    ...(task.assignee ? [pad(`→ ${task.assignee}`, W)] : []),
    ...(task.due      ? [pad(`DUE: ${task.due}`, W)]  : []),
    id,
    divider("━"),
  ].join("\n");
}

// ─── RECEIPT — receipt/invoice style ─────────────────────────────────────────

export function renderReceipt(task: Task): string {
  const now = new Date().toLocaleDateString("en-US", { timeZone: "America/Santiago", month: "short", day: "numeric", year: "numeric" });
  const titleLines = wrap(task.title, W - 2);
  return [
    pad("WORK ORDER", W, "c"),
    pad(now, W, "c"),
    divider(),
    ...titleLines.map(t => ` ${t}`),
    divider(),
    pad(`ID:`, 12) + pad(`#${task.id}`, W - 12, "r"),
    pad(`Priority:`, 12) + pad(PRI[task.priority], W - 12, "r"),
    pad(`Status:`, 12) + pad(STA[task.status], W - 12, "r"),
    ...(task.assignee ? [pad(`Assigned:`, 12) + pad(task.assignee, W - 12, "r")] : []),
    ...(task.due      ? [pad(`Due:`, 12) + pad(task.due, W - 12, "r")]           : []),
    divider(),
    ...(task.tags?.length ? [pad(task.tags.map(t => `[${t}]`).join(" "), W, "c"), ""] : []),
  ].join("\n");
}

// ─── BADGE — big bold name badge / lanyard ───────────────────────────────────

export function renderBadge(task: Task): string {
  const nameLines = wrap(task.title, W - 4);
  return [
    "╔" + "═".repeat(W - 2) + "╗",
    "║" + " ".repeat(W - 2) + "║",
    ...nameLines.map(t => "║" + pad(t, W - 2, "c") + "║"),
    "║" + " ".repeat(W - 2) + "║",
    "╠" + "═".repeat(W - 2) + "╣",
    "║" + pad(STA[task.status], W - 2, "c") + "║",
    ...(task.assignee ? ["║" + pad(task.assignee, W - 2, "c") + "║"] : []),
    "╚" + "═".repeat(W - 2) + "╝",
  ].join("\n");
}

// ─── NOTE — minimal sticky note style ────────────────────────────────────────

export function renderNote(task: Task): string {
  const titleLines = wrap(task.title, W - 2);
  const metaParts = [
    task.assignee ? `@${task.assignee}` : null,
    task.due ? `due ${task.due}` : null,
    task.tags?.length ? task.tags.map(t => `#${t}`).join(" ") : null,
  ].filter(Boolean);

  return [
    divider("▬"),
    ...titleLines.map(t => ` ${t}`),
    "",
    ` ${PRI[task.priority]} · ${STA[task.status]}`,
    ...(metaParts.length ? [" " + metaParts.join("  ")] : []),
    divider("▬"),
  ].join("\n");
}

// ─── Unified renderer ─────────────────────────────────────────────────────────

export function renderTicket(task: Task, style: BorderStyle | TicketTemplate = "thin"): string {
  if (style === "label")   return renderLabel(task);
  if (style === "receipt") return renderReceipt(task);
  if (style === "badge")   return renderBadge(task);
  if (style === "note")    return renderNote(task);
  if (style === "task")    return renderTask(task, "thin");
  if (style === "card")    return renderTask(task, "thin"); // card is image-only; text fallback for preview
  return renderTask(task, style as BorderStyle);
}

export function renderBorders(): string {
  return (Object.entries(borders) as [BorderStyle, Border][]).map(([name, b]) => {
    const inner = W - 2;
    return [
      b.tl + b.h.repeat(inner) + b.tr,
      b.v + pad(name, inner, "c") + b.v,
      b.bl + b.h.repeat(inner) + b.br,
    ].join("\n");
  }).join("\n");
}

export function buildTicket(task: Task, style: BorderStyle | TicketTemplate = "thin"): Uint8Array[] {
  return renderTicket(task, style).split("\n").map(line437);
}

export function buildBorders(): Uint8Array[] {
  return renderBorders().split("\n").map(line437);
}
