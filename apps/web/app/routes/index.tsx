import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import {
  printText, printTicket, printQr,
  printBarcode, printImage, printBorders, printTest,
} from "~/api";
import {
  PrinterBuffer,
  type PrintEntry,
  type PrintEntryInput,
  PRINTER_COLS,
  newId,
} from "~/components/printer-buffer";
import { renderTicket, renderBorders, type BorderStyle } from "@printer/core/render";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";
import { Checkbox } from "~/components/ui/checkbox";
import { Separator } from "~/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

export const Route = createFileRoute("/")({
  component: Playground,
});

type AddEntry = (entry: PrintEntryInput) => void;

// ─── useAction ────────────────────────────────────────────────────────────────

function useAction(fn: () => Promise<unknown>) {
  const [state, setState] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function run() {
    setState("sending");
    try {
      await fn();
      setState("ok");
      setMsg("✓ Sent");
      setTimeout(() => setState("idle"), 2500);
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return { state, msg, run };
}

function Feedback({ state, msg }: { state: string; msg: string }) {
  if (state === "idle") return null;
  return (
    <p className={`text-xs mt-1.5 ${
      state === "ok" ? "text-primary" :
      state === "error" ? "text-destructive" :
      "text-muted-foreground"
    }`}>
      {state === "sending" ? "Sending…" : msg}
    </p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </Label>
      {children}
    </div>
  );
}

// ─── Text tab ─────────────────────────────────────────────────────────────────

function TextTab({ addEntry }: { addEntry: AddEntry }) {
  const [text, setText]     = useState("Hello from the playground!");
  const [align, setAlign]   = useState<"left" | "center" | "right">("left");
  const [bold, setBold]     = useState(false);
  const [invert, setInvert] = useState(false);
  const [size, setSize]     = useState(1);
  const { state, msg, run } = useAction(() => printText({ text, align, bold, invert, size }));

  function handlePrint() {
    addEntry({ type: "text", text, align, bold, invert, size });
    run();
  }

  return (
    <div className="space-y-4">
      <Field label={`Text — max ${PRINTER_COLS} chars/line`}>
        <Textarea
          value={text}
          onChange={e => setText(e.currentTarget.value)}
          placeholder="Text to print…"
          className="font-mono text-sm min-h-24 resize-y"
          style={{ width: `${PRINTER_COLS}ch`, maxWidth: "100%" }}
        />
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
        <Field label="Size 1–8">
          <Input type="number" min={1} max={8} value={size}
            className="font-mono text-sm h-8"
            onChange={e => setSize(Math.max(1, Math.min(8, Number(e.currentTarget.value))))} />
        </Field>
        <Field label="Style">
          <div className="flex flex-col gap-1.5 pt-0.5">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <Checkbox checked={bold} onCheckedChange={v => setBold(v === true)} /> Bold
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <Checkbox checked={invert} onCheckedChange={v => setInvert(v === true)} /> Invert
            </label>
          </div>
        </Field>
      </div>
      <Button size="sm" disabled={state === "sending" || !text.trim()} onClick={handlePrint}>
        Print Text
      </Button>
      <Feedback state={state} msg={msg} />
    </div>
  );
}

// ─── Ticket tab ───────────────────────────────────────────────────────────────

function TicketTab({ addEntry }: { addEntry: AddEntry }) {
  const [id, setId]           = useState("001");
  const [title, setTitle]     = useState("Fix auth bug on Safari");
  const [priority, setPriority] = useState<"LOW"|"MEDIUM"|"HIGH"|"CRITICAL">("HIGH");
  const [status, setStatus]   = useState<"TODO"|"IN PROGRESS"|"DONE"|"BLOCKED">("TODO");
  const [assignee, setAssignee] = useState("");
  const [due, setDue]         = useState("");
  const [tags, setTags]       = useState("");
  const [style, setStyle]     = useState<BorderStyle>("thin");

  const { state, msg, run } = useAction(() =>
    printTicket({
      id, title, priority, status,
      ...(assignee ? { assignee } : {}),
      ...(due ? { due } : {}),
      ...(tags ? { tags: tags.split(",").map(t => t.trim()).filter(Boolean) } : {}),
      style,
    })
  );

  function handlePrint() {
    const tagList = tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : undefined;
    const preview = renderTicket({
      id, title, priority, status,
      assignee: assignee || undefined, due: due || undefined, tags: tagList,
    }, style);
    addEntry({ type: "text", text: preview, align: "left", bold: false, invert: false, size: 1 });
    run();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="ID">
          <Input className="font-mono text-sm h-8" value={id}
            onChange={e => setId(e.currentTarget.value)} placeholder="001" />
        </Field>
        <Field label="Border style">
          <Select value={style} onValueChange={v => setStyle(v as BorderStyle)}>
            <SelectTrigger className="text-sm h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["ascii","thin","double","block","shade","stars"] as BorderStyle[]).map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Title">
        <Input className="font-mono text-sm h-8" value={title}
          onChange={e => setTitle(e.currentTarget.value)} placeholder="Task title…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority">
          <Select value={priority} onValueChange={v => setPriority(v as typeof priority)}>
            <SelectTrigger className="text-sm h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["LOW","MEDIUM","HIGH","CRITICAL"] as const).map(p => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onValueChange={v => setStatus(v as typeof status)}>
            <SelectTrigger className="text-sm h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["TODO","IN PROGRESS","DONE","BLOCKED"] as const).map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Assignee">
          <Input className="font-mono text-sm h-8" value={assignee}
            onChange={e => setAssignee(e.currentTarget.value)} placeholder="optional" />
        </Field>
        <Field label="Due date">
          <Input type="date" className="font-mono text-sm h-8" value={due}
            onChange={e => setDue(e.currentTarget.value)} />
        </Field>
        <Field label="Tags">
          <Input className="font-mono text-sm h-8" value={tags}
            onChange={e => setTags(e.currentTarget.value)} placeholder="auth, bug" />
        </Field>
      </div>
      <Button size="sm" disabled={state === "sending" || !id || !title} onClick={handlePrint}>
        Print Ticket
      </Button>
      <Feedback state={state} msg={msg} />
    </div>
  );
}

// ─── QR tab ───────────────────────────────────────────────────────────────────

function QrTab({ addEntry }: { addEntry: AddEntry }) {
  const [text, setText]       = useState("https://example.com");
  const [size, setSize]       = useState(8);
  const [level, setLevel]     = useState<"L"|"M"|"Q"|"H">("M");
  const { state, msg, run }   = useAction(() => printQr({ text, size, errorLevel: level }));

  function handlePrint() {
    addEntry({ type: "qr", text });
    run();
  }

  return (
    <div className="space-y-4">
      <Field label="URL or text">
        <Input className="font-mono text-sm h-8" value={text}
          onChange={e => setText(e.currentTarget.value)} placeholder="https://…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Module size 1–8">
          <Input type="number" className="font-mono text-sm h-8" min={1} max={8} value={size}
            onChange={e => setSize(Math.max(1, Math.min(8, Number(e.currentTarget.value))))} />
        </Field>
        <Field label="Error correction">
          <Select value={level} onValueChange={v => setLevel(v as typeof level)}>
            <SelectTrigger className="text-sm h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="L">L — 7%</SelectItem>
              <SelectItem value="M">M — 15%</SelectItem>
              <SelectItem value="Q">Q — 25%</SelectItem>
              <SelectItem value="H">H — 30%</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Button size="sm" disabled={state === "sending" || !text.trim()} onClick={handlePrint}>
        Print QR
      </Button>
      <Feedback state={state} msg={msg} />
    </div>
  );
}

// ─── Barcode tab ──────────────────────────────────────────────────────────────

function BarcodeTab({ addEntry }: { addEntry: AddEntry }) {
  const [data, setData]     = useState("HELLO-123");
  const [height, setHeight] = useState(80);
  const { state, msg, run } = useAction(() => printBarcode({ data, height }));

  function handlePrint() {
    addEntry({ type: "barcode", data, height });
    run();
  }

  return (
    <div className="space-y-4">
      <Field label="Data (Code128)">
        <Input className="font-mono text-sm h-8" value={data}
          onChange={e => setData(e.currentTarget.value)} placeholder="HELLO-123" />
      </Field>
      <Field label="Bar height (dots 1–255)">
        <Input type="number" className="font-mono text-sm h-8" min={1} max={255} value={height}
          onChange={e => setHeight(Number(e.currentTarget.value))} />
      </Field>
      <Button size="sm" disabled={state === "sending" || !data.trim()} onClick={handlePrint}>
        Print Barcode
      </Button>
      <Feedback state={state} msg={msg} />
    </div>
  );
}

// ─── Image tab ────────────────────────────────────────────────────────────────

function ImageTab({ addEntry }: { addEntry: AddEntry }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview]   = useState<string | null>(null);
  const [b64, setB64]           = useState<{ image: string; mediaType: string } | null>(null);
  const { state, msg, run }     = useAction(async () => {
    if (!b64) throw new Error("No image selected");
    return printImage(b64);
  });

  function onFile() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const [header = "", data = ""] = result.split(",") as [string, string];
      const mediaType = header.replace("data:", "").replace(";base64", "");
      setPreview(result);
      setB64({ image: data, mediaType });
    };
    reader.readAsDataURL(file);
  }

  function handlePrint() {
    if (preview) addEntry({ type: "image", src: preview });
    run();
  }

  return (
    <div className="space-y-4">
      <Field label="Image file">
        <Input ref={fileRef} type="file" accept="image/*"
          className="font-mono text-sm h-8 cursor-pointer" onChange={onFile} />
      </Field>
      {preview && (
        <img src={preview} alt="Preview"
          className="max-w-[160px] border border-border rounded" />
      )}
      <p className="text-xs text-muted-foreground">
        Scaled to 384 px wide, Floyd-Steinberg dithered to 1-bit.
      </p>
      <Button size="sm" disabled={state === "sending" || !b64} onClick={handlePrint}>
        Print Image
      </Button>
      <Feedback state={state} msg={msg} />
    </div>
  );
}

// ─── Utils tab ────────────────────────────────────────────────────────────────

function UtilsTab({ addEntry }: { addEntry: AddEntry }) {
  const borders = useAction(printBorders);
  const test    = useAction(printTest);

  function handleBorders() {
    addEntry({ type: "text", text: renderBorders(), align: "left", bold: false, invert: false, size: 1 });
    borders.run();
  }

  function handleTest() {
    addEntry({ type: "qr", text: "https://example.com" });
    addEntry({ type: "barcode", data: "TEST-PAGE-001", height: 60 });
    addEntry({ type: "text",
      text: renderTicket({ id: "TST", title: "Test Ticket", priority: "HIGH", status: "TODO" }, "double"),
      align: "left", bold: false, invert: false, size: 1 });
    addEntry({ type: "cut" });
    test.run();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium">Border sampler</p>
        <p className="text-xs text-muted-foreground">Prints all 6 border styles.</p>
        <Button size="sm" variant="secondary" disabled={borders.state === "sending"} onClick={handleBorders}>
          Print Borders
        </Button>
        <Feedback state={borders.state} msg={borders.msg} />
      </div>
      <Separator />
      <div className="space-y-2">
        <p className="text-sm font-medium">Test page</p>
        <p className="text-xs text-muted-foreground">QR, barcode, borders, and a sample ticket.</p>
        <Button size="sm" variant="secondary" disabled={test.state === "sending"} onClick={handleTest}>
          Print Test Page
        </Button>
        <Feedback state={test.state} msg={test.msg} />
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function Playground() {
  const [entries, setEntries] = useState<PrintEntry[]>([]);

  function addEntry(entry: PrintEntryInput) {
    setEntries(prev => [...prev, { ...entry, id: newId() } as PrintEntry]);
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left panel — grows to fill space */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden border-r border-border bg-background">
        <Tabs defaultValue="text" className="flex flex-col h-full overflow-hidden">
          <div className="flex-shrink-0 bg-secondary border-b border-border px-1 pt-1">
            <TabsList className="w-full h-auto p-0 bg-transparent gap-0 rounded-none">
              {(["text","ticket","qr","barcode","image","utils"] as const).map(t => (
                <TabsTrigger key={t} value={t}
                  className="flex-1 text-[11px] py-1.5 rounded-none capitalize
                    border-b-2 border-transparent
                    data-[state=active]:border-primary
                    data-[state=active]:bg-background
                    data-[state=active]:shadow-none
                    data-[state=active]:text-foreground">
                  {t}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <TabsContent value="text"    className="m-0 p-4 focus-visible:outline-none"><TextTab    addEntry={addEntry} /></TabsContent>
            <TabsContent value="ticket"  className="m-0 p-4 focus-visible:outline-none"><TicketTab  addEntry={addEntry} /></TabsContent>
            <TabsContent value="qr"      className="m-0 p-4 focus-visible:outline-none"><QrTab      addEntry={addEntry} /></TabsContent>
            <TabsContent value="barcode" className="m-0 p-4 focus-visible:outline-none"><BarcodeTab addEntry={addEntry} /></TabsContent>
            <TabsContent value="image"   className="m-0 p-4 focus-visible:outline-none"><ImageTab   addEntry={addEntry} /></TabsContent>
            <TabsContent value="utils"   className="m-0 p-4 focus-visible:outline-none"><UtilsTab   addEntry={addEntry} /></TabsContent>
          </div>
        </Tabs>
      </div>

      {/* Printer buffer */}
      <PrinterBuffer entries={entries} onClear={() => setEntries([])} />
    </div>
  );
}
