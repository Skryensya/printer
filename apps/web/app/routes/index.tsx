import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect, useCallback } from "react";
import { faker } from "@faker-js/faker";
import {
  Type, MessageSquare, Ticket, QrCode, ImageIcon, Printer as PrinterIcon, Check, Shuffle,
  ListTodo, Plus, X as XIcon,
} from "lucide-react";
import {
  printText, printTicket, printTodo, printImage,
  type ImageEffect, type CardData,
} from "~/api";
import {
  PrinterBuffer,
  type PrintEntry,
  type PrintEntryInput,
  newId,
} from "~/components/printer-buffer";
import { renderCardSVG } from "@printer/core/render";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";
import { Checkbox } from "~/components/ui/checkbox";
import { Separator } from "~/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "~/components/ui/select";

export const Route = createFileRoute("/")({ component: Playground });

type AddEntry   = (entry: PrintEntryInput) => void;
type SetPreview = (entries: PrintEntryInput[]) => void;
type Tab = "text" | "message" | "ticket" | "qr" | "image" | "todo";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "text",    label: "Text",    icon: Type          },
  { id: "message", label: "Message", icon: MessageSquare },
  { id: "ticket",  label: "Ticket",  icon: Ticket        },
  { id: "qr",      label: "QR",      icon: QrCode        },
  { id: "image",   label: "Image",   icon: ImageIcon     },
  { id: "todo",    label: "List",    icon: ListTodo      },
];

// ─── Shared primitives ────────────────────────────────────────────────────────

function useAction(fn: () => Promise<unknown>) {
  const [state, setState] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [msg, setMsg] = useState("");
  async function run() {
    setState("sending");
    try { await fn(); setState("ok"); setMsg("Sent"); setTimeout(() => setState("idle"), 2500); }
    catch (e) { setState("error"); setMsg(e instanceof Error ? e.message : String(e)); }
  }
  return { state, msg, run };
}

function Feedback({ state, msg }: { state: string; msg: string }) {
  if (state === "idle") return null;
  const cls = state === "ok" ? "text-primary" : state === "error" ? "text-destructive" : "text-muted-foreground";
  const text = state === "sending" ? "Sending…" : state === "ok" ? "✓ " + msg : "✗ " + msg;
  return <p className={`text-xs mt-2 ${cls}`}>{text}</p>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PrintBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <Button size="sm" disabled={disabled} onClick={onClick} className="gap-2 mt-1">
      <PrinterIcon size={13} />{label}
    </Button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">{children}</p>;
}

function ShuffleBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:border-border/80 hover:bg-accent/60 transition-[color,background-color,border-color,transform] active:scale-[0.96]">
      <Shuffle size={13} /> Randomize
    </button>
  );
}

// ─── Faker helpers ────────────────────────────────────────────────────────────

function randomMessage() {
  return {
    from:    faker.person.firstName(),
    message: faker.lorem.sentences({ min: 1, max: 3 }),
    time:    faker.date.recent().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
  };
}

function randomTicket() {
  const priorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
  const statuses   = ["TODO", "IN PROGRESS", "DONE", "BLOCKED"] as const;
  const tagPool    = ["auth", "bug", "ui", "perf", "api", "db", "mobile", "infra", "a11y", "i18n"];
  const tags       = faker.helpers.arrayElements(tagPool, { min: 1, max: 3 }).join(", ");
  return {
    taskId:   String(faker.number.int({ min: 1, max: 999 })).padStart(3, "0"),
    title:    faker.hacker.phrase(),
    priority: faker.helpers.arrayElement(priorities),
    status:   faker.helpers.arrayElement(statuses),
    assignee: `@${faker.internet.username().toLowerCase().slice(0, 12)}`,
    due:      faker.date.soon({ days: 30 }).toISOString().slice(0, 10),
    tags,
  };
}

function randomWikipediaUrl() {
  const lang = faker.helpers.arrayElement(["en", "es"]);
  return `https://${lang}.wikipedia.org/wiki/Special:Random`;
}

// ─── Preset card ──────────────────────────────────────────────────────────────

function PresetCard({
  label, description, active, onClick,
}: {
  label: string; description?: string; active?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "w-full text-left px-3 py-2.5 rounded-lg border transition-[color,background-color,border-color] duration-150 active:scale-[0.96]",
        active
          ? "bg-[var(--color-green-muted)] border-primary/40 text-foreground"
          : "bg-card border-border text-muted-foreground hover:bg-[var(--color-surface-0)] hover:text-foreground hover:border-border",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className={`text-sm font-medium ${active ? "text-primary" : ""}`}>{label}</p>
          {description && (
            <p className={`text-[11px] mt-0.5 ${active ? "text-primary/70" : "text-muted-foreground"}`}>
              {description}
            </p>
          )}
        </div>
        {active && (
          <span className="flex-shrink-0 flex items-center justify-center w-4 h-4 rounded-full bg-primary">
            <Check size={10} className="text-primary-foreground" strokeWidth={3} />
          </span>
        )}
      </div>
    </button>
  );
}

function cardPreviewSrc(card: CardData): string {
  const svg = renderCardSVG(card);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ─── Text ─────────────────────────────────────────────────────────────────────

function TextTab({ addEntry, onPreview }: { addEntry: AddEntry; onPreview: SetPreview }) {
  const [text, setText]     = useState("Hello from the playground!");
  const [align, setAlign]   = useState<"left" | "center" | "right">("left");
  const [bold, setBold]     = useState(false);
  const [invert, setInvert] = useState(false);
  const [size, setSize]     = useState(1);
  const { state, msg, run } = useAction(() => printText({ text, align, bold, invert, size }));
  const COLS_PER_SIZE: Record<number, number> = { 1: 32, 2: 17, 3: 10, 4: 8 };
  const colsPerLine = COLS_PER_SIZE[size] ?? 32;

  useEffect(() => {
    onPreview(text.trim() ? [{ type: "text", text, align, bold, invert, size }] : []);
  }, [text, align, bold, invert, size, onPreview]);

  function handlePrint() {
    addEntry({ type: "text", text, align, bold, invert, size });
    run();
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Field label="Content" hint={`${colsPerLine} chars per line at size ${size}`}>
          <Textarea value={text} onChange={e => setText(e.currentTarget.value)}
            placeholder="Text to print…" className="font-mono text-sm min-h-24 resize-y w-full" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Align">
            <Select value={align} onValueChange={v => setAlign(v as typeof align)}>
              <SelectTrigger className="text-sm h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="center">Center</SelectItem>
                <SelectItem value="right">Right</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Size" hint="1 – 4">
            <Input type="number" min={1} max={4} value={size} className="font-mono text-sm h-8"
              onChange={e => setSize(Math.max(1, Math.min(4, Number(e.currentTarget.value))))} />
          </Field>
          <Field label="Style">
            <div className="flex flex-col gap-2 pt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox checked={bold} onCheckedChange={v => setBold(v === true)} /> Bold
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox checked={invert} onCheckedChange={v => setInvert(v === true)} /> Invert
              </label>
            </div>
          </Field>
        </div>
      </div>
      <div>
        <PrintBtn label="Print Text" disabled={state === "sending" || !text.trim()} onClick={handlePrint} />
        <Feedback state={state} msg={msg} />
      </div>
    </div>
  );
}

// ─── Message ──────────────────────────────────────────────────────────────────

function MessageTab({ addEntry, onPreview }: { addEntry: AddEntry; onPreview: SetPreview }) {
  const [from, setFrom]       = useState("");
  const [message, setMessage] = useState("");
  const [msgDate, setMsgDate] = useState(() => {
    const now = new Date();
    return now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  });

  function buildCard(): CardData {
    return {
      from:  from || undefined,
      date:  msgDate || undefined,
      title: message,
    };
  }

  const { state, msg, run } = useAction(() => printTicket(buildCard()));

  useEffect(() => {
    if (!message.trim()) { onPreview([]); return; }
    onPreview([{ type: "image", src: cardPreviewSrc(buildCard()), effect: "photo" }]);
  }, [from, message, msgDate, onPreview]);

  function handlePrint() {
    const card = buildCard();
    addEntry({ type: "image", src: cardPreviewSrc(card), effect: "photo" });
    run();
  }

  function shuffle() {
    const r = randomMessage();
    setFrom(r.from);
    setMessage(r.message);
    setMsgDate(r.time);
  }

  return (
    <div className="space-y-5">
      <div><ShuffleBtn onClick={shuffle} /></div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="From" hint="optional">
          <Input className="font-mono text-sm h-8" value={from}
            onChange={e => setFrom(e.currentTarget.value)} placeholder="Name" />
        </Field>
        <Field label="Time">
          <Input className="font-mono text-sm h-8" value={msgDate}
            onChange={e => setMsgDate(e.currentTarget.value)} placeholder="10:30 AM" />
        </Field>
      </div>
      <Field label="Message">
        <Textarea value={message} onChange={e => setMessage(e.currentTarget.value)}
          placeholder="Write your message…" className="font-mono text-sm min-h-24 resize-y" />
      </Field>
      <div>
        <PrintBtn label="Print Message" disabled={state === "sending" || !message.trim()} onClick={handlePrint} />
        <Feedback state={state} msg={msg} />
      </div>
    </div>
  );
}

// ─── Ticket ───────────────────────────────────────────────────────────────────

const PRI_SHORT: Record<string, string> = { LOW: "LOW", MEDIUM: "MED", HIGH: "HIGH", CRITICAL: "CRIT!" };
const STATUS_DOT: Record<string, string> = { "TODO": "○", "IN PROGRESS": "◐", "DONE": "●", "BLOCKED": "✕" };

function TicketTab({ addEntry, onPreview }: { addEntry: AddEntry; onPreview: SetPreview }) {
  const [taskId, setTaskId]     = useState("001");
  const [title, setTitle]       = useState("Fix auth bug on Safari");
  const [priority, setPriority] = useState<"LOW"|"MEDIUM"|"HIGH"|"CRITICAL">("HIGH");
  const [status, setStatus]     = useState<"TODO"|"IN PROGRESS"|"DONE"|"BLOCKED">("TODO");
  const [assignee, setAssignee] = useState("");
  const [due, setDue]           = useState("");
  const [tags, setTags]         = useState("");

  function formatDue(iso: string): string {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${(y ?? "").slice(2)}`;
  }

  function buildCard(): CardData {
    const rows: [string, string][] = [];
    rows.push(["Status", `${STATUS_DOT[status] ?? "·"} ${status}`]);
    if (assignee) rows.push(["Assigned", assignee]);
    if (tags) rows.push(["Tags", tags.split(",").map(t => `#${t.trim()}`).filter(Boolean).join("  ")]);
    return {
      badge: PRI_SHORT[priority] ?? priority,
      label: taskId,
      date:  formatDue(due || new Date().toISOString().slice(0, 10)),
      title,
      rows,
    };
  }

  const { state, msg, run } = useAction(() => printTicket(buildCard()));

  useEffect(() => {
    if (!title.trim()) { onPreview([]); return; }
    onPreview([{ type: "image", src: cardPreviewSrc(buildCard()), effect: "photo" }]);
  }, [taskId, title, priority, status, assignee, due, tags, onPreview]);

  function handlePrint() {
    const card = buildCard();
    addEntry({ type: "image", src: cardPreviewSrc(card), effect: "photo" });
    run();
  }

  function shuffle() {
    const r = randomTicket();
    setTaskId(r.taskId);
    setTitle(r.title);
    setPriority(r.priority);
    setStatus(r.status);
    setAssignee(r.assignee);
    setDue(r.due);
    setTags(r.tags);
  }

  return (
    <div className="space-y-5">
      <div><ShuffleBtn onClick={shuffle} /></div>
      <Field label="Title">
        <Input className="font-mono text-sm h-8 w-full" value={title}
          onChange={e => setTitle(e.currentTarget.value)} placeholder="Task title…" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="ID">
          <Input className="font-mono text-sm h-8" value={taskId}
            onChange={e => setTaskId(e.currentTarget.value)} placeholder="001" />
        </Field>
        <Field label="Priority">
          <Select value={priority} onValueChange={v => setPriority(v as typeof priority)}>
            <SelectTrigger className="text-sm h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["LOW","MEDIUM","HIGH","CRITICAL"] as const).map(p =>
                <SelectItem key={p} value={p}>{p}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Status">
          <Select value={status} onValueChange={v => setStatus(v as typeof status)}>
            <SelectTrigger className="text-sm h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["TODO","IN PROGRESS","DONE","BLOCKED"] as const).map(s =>
                <SelectItem key={s} value={s}>{s}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Assignee" hint="optional">
          <Input className="font-mono text-sm h-8" value={assignee}
            onChange={e => setAssignee(e.currentTarget.value)} placeholder="@name" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Due date" hint="optional">
          <Input type="date" className="font-mono text-sm h-8" value={due}
            onChange={e => setDue(e.currentTarget.value)} />
        </Field>
        <Field label="Tags" hint="comma-separated">
          <Input className="font-mono text-sm h-8" value={tags}
            onChange={e => setTags(e.currentTarget.value)} placeholder="auth, bug" />
        </Field>
      </div>

      <div>
        <PrintBtn label="Print Ticket" disabled={state === "sending" || !title.trim()} onClick={handlePrint} />
        <Feedback state={state} msg={msg} />
      </div>
    </div>
  );
}

// ─── QR ───────────────────────────────────────────────────────────────────────

type QrPresetId = "url" | "wifi" | "vcard" | "text";

const QR_PRESETS: { id: QrPresetId; label: string; description: string }[] = [
  { id: "url",   label: "URL",   description: "Website link"    },
  { id: "wifi",  label: "WiFi",  description: "WPA/WEP network" },
  { id: "vcard", label: "vCard", description: "Contact card"    },
  { id: "text",  label: "Text",  description: "Plain text"      },
];

function escapeWifi(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/"/g, '\\"');
}

function buildQrText(preset: QrPresetId, fields: {
  url: string; text: string;
  wifiSsid: string; wifiPass: string; wifiSec: "WPA" | "WEP" | "nopass";
  vcardName: string; vcardPhone: string; vcardEmail: string; vcardOrg: string;
}): string {
  switch (preset) {
    case "url":  return fields.url;
    case "text": return fields.text;
    case "wifi": return `WIFI:T:${fields.wifiSec};S:${escapeWifi(fields.wifiSsid)};P:${escapeWifi(fields.wifiPass)};;`;
    case "vcard": {
      const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${fields.vcardName}`];
      if (fields.vcardPhone) lines.push(`TEL;TYPE=CELL:${fields.vcardPhone}`);
      if (fields.vcardEmail) lines.push(`EMAIL;TYPE=INTERNET:${fields.vcardEmail}`);
      if (fields.vcardOrg)   lines.push(`ORG:${fields.vcardOrg}`);
      lines.push("END:VCARD");
      return lines.join("\n");
    }
  }
}

function QrTab({ addEntry, onPreview }: { addEntry: AddEntry; onPreview: SetPreview }) {
  const [preset, setPreset] = useState<QrPresetId>("url");

  const [url, setUrl]               = useState(() => randomWikipediaUrl());
  const [wifiSsid, setWifiSsid]     = useState("");
  const [wifiPass, setWifiPass]     = useState("");
  const [wifiSec, setWifiSec]       = useState<"WPA"|"WEP"|"nopass">("WPA");
  const [vcardName, setVcardName]   = useState("");
  const [vcardPhone, setVcardPhone] = useState("");
  const [vcardEmail, setVcardEmail] = useState("");
  const [vcardOrg, setVcardOrg]     = useState("");
  const [qrText, setQrText]         = useState("");
  const [labelOverride, setLabelOverride] = useState<string | null>(null);

  function autoLabel(): string {
    if (preset === "wifi")  return wifiSsid;
    if (preset === "vcard") return vcardName;
    if (preset === "url") {
      try { return new URL(url).hostname; } catch { return ""; }
    }
    return "";
  }

  const cardTitle = labelOverride ?? autoLabel();

  function handlePresetChange(p: QrPresetId) {
    setPreset(p);
    setLabelOverride(null);
  }

  function handleLabelChange(v: string) {
    setLabelOverride(v === "" ? null : v);
  }

  const qrContent = buildQrText(preset, {
    url, text: qrText, wifiSsid, wifiPass, wifiSec,
    vcardName, vcardPhone, vcardEmail, vcardOrg,
  });

  function buildQrCard(): CardData {
    return {
      label: cardTitle.trim() || undefined,
      title: preset === "url" ? qrContent : undefined,
      qr:    qrContent,
    };
  }

  const { state, msg, run } = useAction(async () => {
    await printTicket(buildQrCard());
  });

  useEffect(() => {
    let cancelled = false;
    async function updatePreview() {
      if (!qrContent.trim()) { onPreview([]); return; }
      const src = cardPreviewSrc(buildQrCard());
      if (!cancelled) onPreview([{ type: "image", src, effect: "photo" }]);
    }
    updatePreview();
    return () => { cancelled = true; };
  }, [qrContent, cardTitle, preset, onPreview]);

  async function handlePrint() {
    addEntry({ type: "image", src: cardPreviewSrc(buildQrCard()), effect: "photo" });
    run();
  }

  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>Type</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {QR_PRESETS.map(p => (
            <PresetCard key={p.id} label={p.label} description={p.description}
              active={preset === p.id} onClick={() => handlePresetChange(p.id)} />
          ))}
        </div>
      </div>

      {preset === "url" && (
        <Field label="URL">
          <Textarea value={url} onChange={e => setUrl(e.currentTarget.value)}
            placeholder="https://example.com"
            className="font-mono text-sm min-h-[2rem] resize-none leading-relaxed" />
        </Field>
      )}
      {preset === "text" && (
        <Field label="Text">
          <Textarea value={qrText} onChange={e => setQrText(e.currentTarget.value)}
            className="font-mono text-sm min-h-16 resize-y" placeholder="Any text…" />
        </Field>
      )}
      {preset === "wifi" && (
        <div className="space-y-3">
          <Field label="Network name (SSID)">
            <Input value={wifiSsid} onChange={e => setWifiSsid(e.currentTarget.value)}
              placeholder="MyNetwork" className="text-sm h-8" />
          </Field>
          <Field label="Password">
            <Input value={wifiPass} onChange={e => setWifiPass(e.currentTarget.value)}
              type="password" placeholder="••••••••" className="text-sm h-8" />
          </Field>
          <Field label="Security">
            <Select value={wifiSec} onValueChange={v => setWifiSec(v as typeof wifiSec)}>
              <SelectTrigger className="text-sm h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="WPA">WPA / WPA2</SelectItem>
                <SelectItem value="WEP">WEP</SelectItem>
                <SelectItem value="nopass">None (open)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}
      {preset === "vcard" && (
        <div className="space-y-3">
          <Field label="Full name">
            <Input value={vcardName} onChange={e => setVcardName(e.currentTarget.value)}
              placeholder="Jane Doe" className="text-sm h-8" />
          </Field>
          <Field label="Phone">
            <Input value={vcardPhone} onChange={e => setVcardPhone(e.currentTarget.value)}
              type="tel" placeholder="+1 555 000 0000" className="text-sm h-8" />
          </Field>
          <Field label="Email">
            <Input value={vcardEmail} onChange={e => setVcardEmail(e.currentTarget.value)}
              type="email" placeholder="jane@example.com" className="text-sm h-8" />
          </Field>
          <Field label="Organization" hint="optional">
            <Input value={vcardOrg} onChange={e => setVcardOrg(e.currentTarget.value)}
              placeholder="Acme Corp" className="text-sm h-8" />
          </Field>
        </div>
      )}

      <Separator />

      <Field label="Header label" hint="optional">
        <Input className="font-mono text-sm h-8" value={cardTitle}
          onChange={e => handleLabelChange(e.currentTarget.value)}
          placeholder="Auto" />
      </Field>

      <div className="flex items-center gap-4">
        <PrintBtn label="Print QR" disabled={state === "sending" || !qrContent.trim()} onClick={handlePrint} />
        {preset === "url" && <ShuffleBtn onClick={() => setUrl(randomWikipediaUrl())} />}
      </div>
      <Feedback state={state} msg={msg} />
    </div>
  );
}

// ─── Image ────────────────────────────────────────────────────────────────────

const EFFECTS: { id: ImageEffect; label: string; description: string }[] = [
  { id: "photo",  label: "Photo",  description: "Pre-brightened + Atkinson" },
  { id: "invert", label: "Invert", description: "Invert tones then dither"  },
];

function ImageTab({ addEntry }: { addEntry: AddEntry }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [src, setSrc]           = useState<string | null>(null);
  const [b64, setB64]           = useState<{ image: string; mediaType: string } | null>(null);
  const [effect, setEffect]     = useState<ImageEffect>("photo");
  const [preview, setPreview]   = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const { state, msg, run }     = useAction(async () => {
    if (!b64) throw new Error("No image selected");
    return printImage({ ...b64, effect });
  });

  function atkinsonGray(gray: Float32Array, W: number, H: number) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const idx = y * W + x, old = gray[idx]!, nw = old < 128 ? 0 : 255;
      gray[idx] = nw; const err = Math.floor((old - nw) / 8);
      if (x+1<W)        gray[idx+1]!   += err;
      if (x+2<W)        gray[idx+2]!   += err;
      if (y+1<H&&x>0)   gray[idx+W-1]! += err;
      if (y+1<H)        gray[idx+W]!   += err;
      if (y+1<H&&x+1<W) gray[idx+W+1]! += err;
      if (y+2<H)        gray[idx+W*2]! += err;
    }
  }

  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      const W = 384, H = Math.round((img.naturalHeight / img.naturalWidth) * W);
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      const id = ctx.getImageData(0, 0, W, H); const d = id.data;
      const gray = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) gray[i] = 0.299 * d[i*4]! + 0.587 * d[i*4+1]! + 0.114 * d[i*4+2]!;
      if (effect === "photo") {
        for (let i = 0; i < gray.length; i++) gray[i] = Math.pow(gray[i]!/255, 1/2.2) * 255;
      } else {
        for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i]!;
      }
      atkinsonGray(gray, W, H);
      for (let i = 0; i < W * H; i++) {
        const v = gray[i]! < 128 ? 0 : 255;
        d[i*4] = d[i*4+1] = d[i*4+2] = v; d[i*4+3] = 255;
      }
      ctx.putImageData(id, 0, 0);
      setPreview(canvas.toDataURL("image/png"));
    };
    img.src = src;
  }, [src, effect]);

  function loadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const [header = "", data = ""] = result.split(",") as [string, string];
      setSrc(result);
      setB64({ image: data, mediaType: header.replace("data:", "").replace(";base64", "") });
    };
    reader.readAsDataURL(file);
  }

  function onFile() {
    const file = fileRef.current?.files?.[0];
    if (file) loadFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith("image/")) loadFile(file);
  }

  function handlePrint() {
    if (src) addEntry({ type: "image", src, effect });
    run();
  }

  return (
    <div className="space-y-5">
      {/* Drop zone */}
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          "relative cursor-pointer rounded-lg border-2 overflow-hidden transition-colors",
          dragging
            ? "border-primary bg-primary/5"
            : preview
              ? "border-border hover:border-primary/40"
              : "border-dashed border-border hover:border-primary/40 hover:bg-accent/30",
        ].join(" ")}
      >
        {preview ? (
          <>
            <img src={preview} alt="Preview" className="w-full block bg-white"
              style={{ imageRendering: "pixelated" }} />
            <div className="absolute inset-0 flex items-end justify-end p-2 opacity-0 hover:opacity-100 transition-opacity">
              <span className="text-[11px] bg-black/70 text-white px-2 py-1 rounded-md">
                Change image
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground select-none">
            <ImageIcon size={28} strokeWidth={1.5} />
            <p className="text-sm">Drop an image or click to browse</p>
            <p className="text-[11px] opacity-60">Scaled to 384 px (58 mm at 203 DPI)</p>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
      </div>

      {/* Effect toggle */}
      <div className="flex gap-1 p-1 bg-secondary rounded-lg">
        {EFFECTS.map(e => (
          <button key={e.id} onClick={() => setEffect(e.id as ImageEffect)}
            className={[
              "flex-1 py-1.5 rounded-md text-sm transition-colors",
              effect === e.id
                ? "bg-background shadow-sm font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}>
            {e.label}
          </button>
        ))}
      </div>

      <div>
        <PrintBtn label="Print Image" disabled={state === "sending" || !b64} onClick={handlePrint} />
        <Feedback state={state} msg={msg} />
      </div>
    </div>
  );
}

// ─── Todo / Shopping list ────────────────────────────────────────────────────

type TodoItem = { name: string; qty: string };

function TodoTab({ addEntry, onPreview }: { addEntry: AddEntry; onPreview: SetPreview }) {
  const [title, setTitle] = useState("Shopping List");
  const [badge, setBadge] = useState("");
  const [items, setItems] = useState<TodoItem[]>([
    { name: "", qty: "" }, { name: "", qty: "" }, { name: "", qty: "" },
  ]);
  const [focusNext, setFocusNext] = useState<{ idx: number; field: "name" | "qty" } | null>(null);
  const nameRefs = useRef<(HTMLInputElement | null)[]>([]);
  const qtyRefs  = useRef<(HTMLInputElement | null)[]>([]);

  const nonEmpty = items.filter(i => i.name.trim());

  useEffect(() => {
    if (!focusNext) return;
    const ref = focusNext.field === "name" ? nameRefs.current[focusNext.idx] : qtyRefs.current[focusNext.idx];
    ref?.focus();
    setFocusNext(null);
  }, [focusNext, items.length]);

  function buildCard(): CardData {
    const now = new Date();
    const d = String(now.getDate()).padStart(2, "0");
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const y = String(now.getFullYear()).slice(2);
    return {
      label: title.trim() || undefined,
      badge: badge.trim() || undefined,
      date:  `${d}/${m}/${y}`,
      rows:  nonEmpty.map(i => ["[ ]", i.name, i.qty || ""] as [string, string, string]),
    };
  }

  useEffect(() => {
    if (nonEmpty.length === 0) { onPreview([]); return; }
    onPreview([{ type: "image", src: cardPreviewSrc(buildCard()), effect: "photo" }]);
  }, [title, badge, JSON.stringify(items), onPreview]);

  const { state, msg, run } = useAction(async () => {
    await printTodo({
      items: nonEmpty.map(i => i.qty.trim() ? [i.name, i.qty.trim()] as [string, string] : i.name),
      title: title.trim() || undefined,
      badge: badge.trim() || undefined,
    });
  });

  function handlePrint() {
    if (nonEmpty.length === 0) return;
    addEntry({ type: "image", src: cardPreviewSrc(buildCard()), effect: "photo" });
    run();
  }

  function addItem() {
    const idx = items.length;
    setItems(prev => [...prev, { name: "", qty: "" }]);
    setFocusNext({ idx, field: "name" });
  }

  function removeItem(idx: number) {
    setItems(prev => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : [{ name: "", qty: "" }];
    });
    setFocusNext({ idx: Math.max(0, idx - 1), field: "name" });
  }

  function updateName(idx: number, val: string) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, name: val } : it));
  }

  function updateQty(idx: number, val: string) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, qty: val } : it));
  }

  function handleNameKeyDown(e: React.KeyboardEvent<HTMLInputElement>, idx: number) {
    if (e.key === "Enter") {
      e.preventDefault();
      setFocusNext({ idx, field: "qty" });
    }
    if (e.key === "Backspace" && !items[idx]?.name) {
      e.preventDefault();
      removeItem(idx);
    }
  }

  function handleQtyKeyDown(e: React.KeyboardEvent<HTMLInputElement>, idx: number) {
    if (e.key === "Enter") {
      e.preventDefault();
      const newIdx = idx + 1;
      setItems(prev => {
        const next = [...prev];
        next.splice(newIdx, 0, { name: "", qty: "" });
        return next;
      });
      setFocusNext({ idx: newIdx, field: "name" });
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Title">
          <Input value={title} onChange={e => setTitle(e.currentTarget.value)}
            placeholder="Shopping List" className="text-sm h-8" />
        </Field>
        <Field label="Badge" hint="optional">
          <Input value={badge} onChange={e => setBadge(e.currentTarget.value.toUpperCase())}
            placeholder="GROCERIES" className="text-sm h-8 font-mono" />
        </Field>
      </div>

      <Separator />

      {/* Column headers */}
      <div className="flex items-center gap-2 px-0">
        <span className="w-4 flex-shrink-0" />
        <span className="flex-1 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Item</span>
        <span className="w-20 flex-shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Unit</span>
        <span className="w-4 flex-shrink-0" />
      </div>

      <div className="space-y-1.5">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-2 group">
            <span className="w-8 flex-shrink-0 text-muted-foreground/40 text-sm select-none font-mono">[ ]</span>
            <input
              ref={el => { nameRefs.current[idx] = el; }}
              value={item.name}
              onChange={e => updateName(idx, e.target.value)}
              onKeyDown={e => handleNameKeyDown(e, idx)}
              placeholder={`Item ${idx + 1}`}
              className="flex-1 text-sm h-8 bg-transparent border-0 border-b border-border/50 focus:border-primary/50 focus:outline-none px-0 py-1 transition-colors placeholder:text-muted-foreground/30"
            />
            <input
              ref={el => { qtyRefs.current[idx] = el; }}
              value={item.qty}
              onChange={e => updateQty(idx, e.target.value)}
              onKeyDown={e => handleQtyKeyDown(e, idx)}
              placeholder="qty"
              className="w-20 flex-shrink-0 text-sm h-8 bg-transparent border-0 border-b border-border/50 focus:border-primary/50 focus:outline-none px-0 py-1 transition-colors placeholder:text-muted-foreground/30 text-right font-mono"
            />
            <button
              onClick={() => removeItem(idx)}
              className="w-10 h-10 flex-shrink-0 flex items-center justify-center -mr-3 text-muted-foreground/20 hover:text-destructive transition-[color,transform] active:scale-[0.96] opacity-0 group-hover:opacity-100"
            >
              <XIcon size={13} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addItem}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Plus size={12} /> Add item
      </button>

      <Separator />

      <div className="flex items-center gap-4">
        <PrintBtn label="Print List" disabled={state === "sending" || nonEmpty.length === 0} onClick={handlePrint} />
      </div>
      <Feedback state={state} msg={msg} />
    </div>
  );
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="flex-shrink-0 border-b border-border bg-secondary/40">
      <div className="max-w-4xl mx-auto px-6 py-2 flex items-center gap-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => onChange(id)}
            className={[
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors",
              active === id
                ? "bg-background text-foreground font-medium shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            ].join(" ")}>
            <Icon size={13} />{label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function Playground() {
  const [tab, setTab]                       = useState<Tab>("message");
  const [entries, setEntries]               = useState<PrintEntry[]>([]);
  const [previewEntries, setPreviewEntries] = useState<PrintEntry[]>([]);

  function addEntry(entry: PrintEntryInput) {
    setEntries(prev => [...prev, { ...entry, id: newId() } as PrintEntry]);
  }

  const handlePreview = useCallback((inputs: PrintEntryInput[]) => {
    setPreviewEntries(inputs.map((e, i) => ({ ...e, id: `preview-${i}` } as PrintEntry)));
  }, []);

  function handleTabChange(t: Tab) {
    setTab(t);
    setPreviewEntries([]);
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <TabBar active={tab} onChange={handleTabChange} />
      <div className="flex-1 min-h-0 overflow-hidden max-w-4xl mx-auto w-full flex">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden border-r border-border">
          <div className="flex-1 min-h-0 overflow-y-auto p-6">
            <div className="max-w-sm">
              {tab === "text"    && <TextTab    addEntry={addEntry} onPreview={handlePreview} />}
              {tab === "message" && <MessageTab addEntry={addEntry} onPreview={handlePreview} />}
              {tab === "ticket"  && <TicketTab  addEntry={addEntry} onPreview={handlePreview} />}
              {tab === "qr"      && <QrTab      addEntry={addEntry} onPreview={handlePreview} />}
              {tab === "image"   && <ImageTab   addEntry={addEntry} />}
              {tab === "todo"    && <TodoTab    addEntry={addEntry} onPreview={handlePreview} />}
            </div>
          </div>
        </div>
        <PrinterBuffer entries={entries} previewEntries={previewEntries} onClear={() => setEntries([])} />
      </div>
    </div>
  );
}
