import { line437 } from "./encode437";

const W = 32; // 58mm paper, Font A: 32 chars per line

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type Status   = "TODO" | "IN PROGRESS" | "DONE" | "BLOCKED";

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
  LOW:      "[ LOW      ]",
  MEDIUM:   "[ MEDIUM   ]",
  HIGH:     "[ HIGH     ]",
  CRITICAL: "[!CRITICAL!]",
};

const STA: Record<Status, string> = {
  "TODO":        "( ) TODO",
  "IN PROGRESS": "(~) IN PROGRESS",
  "DONE":        "(*) DONE",
  "BLOCKED":     "(X) BLOCKED",
};

function pad(text: string, w: number, align: "l"|"c"|"r" = "l"): string {
  const t = text.slice(0, w);
  const gap = w - t.length;
  if (align === "c") { const l = Math.floor(gap/2); return " ".repeat(l) + t + " ".repeat(gap-l); }
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

export function renderTicket(task: Task, style: BorderStyle = "thin"): string {
  const b = borders[style];
  const inner = W - 2;
  const strRow  = (t: string) => b.v + pad(t, inner) + b.v;
  const strRowC = (t: string) => b.v + pad(t, inner, "c") + b.v;
  const titleLines = wrap(task.title, inner - 1);
  return [
    b.tl + b.h.repeat(inner) + b.tr,
    strRowC(`TASK #${task.id}`),
    b.ml + b.mh.repeat(inner) + b.mr,
    ...titleLines.map(t => strRow(` ${t}`)),
    b.ml + b.mh.repeat(inner) + b.mr,
    strRow(` PRI ${PRI[task.priority]}`),
    strRow(` STA ${STA[task.status]}`),
    ...(task.assignee ? [strRow(` WHO ${task.assignee}`)]           : []),
    ...(task.due      ? [strRow(` DUE ${task.due}`)]                : []),
    ...(task.tags?.length ? [strRow(` TAG ${task.tags.join(" ")}`)] : []),
    b.bl + b.h.repeat(inner) + b.br,
  ].join("\n");
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

export function buildTicket(task: Task, style: BorderStyle = "thin"): Uint8Array[] {
  return renderTicket(task, style).split("\n").map(line437);
}

export function buildBorders(): Uint8Array[] {
  return renderBorders().split("\n").map(line437);
}
