import { useEffect, useLayoutEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PrintEntry =
  | {
      id: string;
      type: "text";
      text: string;
      align: "left" | "center" | "right";
      bold: boolean;
      size: number;
      invert: boolean;
    }
  | { id: string; type: "image"; src: string }
  | { id: string; type: "qr"; text: string }
  | { id: string; type: "barcode"; data: string; height: number }
  | { id: string; type: "cut" }
  | { id: string; type: "feed"; lines: number };

// POS-58 Font A: 32 chars per line, 384 dots wide
export const PRINTER_COLS = 32;

// Distributive omit — works correctly with union types
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type PrintEntryInput = DistributiveOmit<PrintEntry, "id">;

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _idCounter = 0;
export function newId() {
  return String(++_idCounter);
}

// Floyd-Steinberg dither to 1-bit, returns a data-URL
function ditherCanvas(img: HTMLImageElement): string {
  const W = 384;
  const H = Math.round((img.naturalHeight / img.naturalWidth) * W);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, W, H);
  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;

  // grayscale
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = 0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!;
  }

  // Floyd-Steinberg
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const old = gray[idx]!;
      const nw = old < 128 ? 0 : 255;
      gray[idx] = nw;
      const err = old - nw;
      if (x + 1 < W)         gray[idx + 1]!         += err * 7 / 16;
      if (y + 1 < H && x > 0)      gray[idx + W - 1]! += err * 3 / 16;
      if (y + 1 < H)          gray[idx + W]!          += err * 5 / 16;
      if (y + 1 < H && x + 1 < W)  gray[idx + W + 1]! += err * 1 / 16;
    }
  }

  for (let i = 0; i < W * H; i++) {
    const v = gray[i]! < 128 ? 0 : 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return canvas.toDataURL("image/png");
}

// ─── Entry Renderers ─────────────────────────────────────────────────────────

function TextLine({ entry }: { entry: Extract<PrintEntry, { type: "text" }> }) {
  const lines = entry.text.split("\n");
  const colsPerLine = Math.max(1, Math.floor(PRINTER_COLS / entry.size));

  const alignClass =
    entry.align === "center"
      ? "text-center"
      : entry.align === "right"
      ? "text-right"
      : "text-left";

  return (
    <div
      className={alignClass}
      style={{
        fontSize: `${entry.size * 0.75}rem`,
        fontWeight: entry.bold ? "bold" : "normal",
        lineHeight: 1.15,
        wordBreak: "break-all",
        maxWidth: `${colsPerLine}ch`,
        marginLeft: entry.align === "right" ? "auto" : entry.align === "center" ? "auto" : undefined,
        marginRight: entry.align === "left" ? "auto" : entry.align === "center" ? "auto" : undefined,
        ...(entry.invert
          ? { background: "#1a1a1a", color: "#f5f0e8", padding: "0 2px" }
          : {}),
      }}
    >
      {lines.map((line, i) => (
        <div key={i}>{line || " "}</div>
      ))}
    </div>
  );
}

function ImageLine({ entry }: { entry: Extract<PrintEntry, { type: "image" }> }) {
  const [dithered, setDithered] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setDithered(ditherCanvas(img));
    img.src = entry.src;
  }, [entry.src]);

  if (!dithered) return (
    <img
      ref={imgRef}
      src={entry.src}
      alt=""
      className="w-full"
      style={{ imageRendering: "pixelated", filter: "grayscale(1) contrast(2)" }}
    />
  );

  return (
    <img
      src={dithered}
      alt=""
      className="w-full"
      style={{ imageRendering: "pixelated" }}
    />
  );
}

function QrLine({ entry }: { entry: Extract<PrintEntry, { type: "qr" }> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, entry.text, {
      width: 256,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#1a1a1a", light: "#faf9f7" },
    });
  }, [entry.text]);

  return (
    <div className="flex justify-center">
      <canvas ref={canvasRef} style={{ imageRendering: "pixelated", width: "192px", height: "192px" }} />
    </div>
  );
}

function BarcodeLine({ entry }: { entry: Extract<PrintEntry, { type: "barcode" }> }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, entry.data, {
        format: "CODE128",
        width: 2,
        height: entry.height,
        displayValue: true,
        fontSize: 12,
        margin: 4,
        background: "#faf9f7",
        lineColor: "#1a1a1a",
      });
    } catch {
      // invalid barcode data — render nothing
    }
  }, [entry.data, entry.height]);

  return (
    <div className="flex justify-center">
      <svg ref={svgRef} className="w-full" />
    </div>
  );
}

function CutLine() {
  return (
    <div className="flex items-center gap-1 py-1 text-[--color-muted]">
      <div className="flex-1 border-t border-dashed border-current" />
      <span className="text-xs">✂</span>
      <div className="flex-1 border-t border-dashed border-current" />
    </div>
  );
}

function FeedLine({ entry }: { entry: Extract<PrintEntry, { type: "feed" }> }) {
  return <div style={{ height: `${entry.lines * 1.2}rem` }} />;
}

function EntryRenderer({ entry }: { entry: PrintEntry }) {
  switch (entry.type) {
    case "text":    return <TextLine entry={entry} />;
    case "image":   return <ImageLine entry={entry} />;
    case "qr":      return <QrLine entry={entry} />;
    case "barcode": return <BarcodeLine entry={entry} />;
    case "cut":     return <CutLine />;
    case "feed":    return <FeedLine entry={entry} />;
  }
}

// px/ms — matches ~90 mm/s thermal head at 96 dpi (1mm ≈ 3.78px)
const PRINT_SPEED = 0.34;

function PrinterEntry({ entry, animate }: { entry: PrintEntry; animate: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!animate || !ref.current) return;
    const el = ref.current;
    const h = el.scrollHeight;
    const ms = Math.max(80, h / PRINT_SPEED);

    el.style.height = "0px";
    el.style.overflow = "hidden";

    // double rAF: first frame sets h=0, second starts the transition
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = `height ${ms}ms linear`;
      el.style.height = `${h}px`;
      const done = () => {
        el.style.height = "";
        el.style.overflow = "";
        el.style.transition = "";
      };
      el.addEventListener("transitionend", done, { once: true });
    }));
  }, [animate]);

  return (
    <div ref={ref}>
      <EntryRenderer entry={entry} />
    </div>
  );
}

// ─── PrinterBuffer ────────────────────────────────────────────────────────────

interface Props {
  entries: PrintEntry[];
  onClear?: () => void;
}

export function PrinterBuffer({ entries, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const knownIds = useRef(new Set<string>());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const added = entries.filter(e => !knownIds.current.has(e.id));
    if (added.length) {
      added.forEach(e => knownIds.current.add(e.id));
      setNewIds(prev => {
        const next = new Set(prev);
        added.forEach(e => next.add(e.id));
        return next;
      });
    }
  }, [entries]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }, [entries.length]);

  return (
    <div
      className="flex-shrink-0 flex flex-col min-h-0 bg-[#c8bfaf] overflow-hidden border-l border-[#a09080]"
      style={{ fontFamily: "var(--font-mono)", fontSize: "12px", width: `calc(${PRINTER_COLS}ch + 3rem)` }}
    >
      {/* toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#b8af9f] border-b border-[#a09080]">
        <span className="text-[10px] text-[--color-muted] font-mono tracking-wide">
          POS-58 · {PRINTER_COLS}col
        </span>
        {entries.length > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] text-[--color-muted] hover:text-[--color-ink] transition-colors"
          >
            clear
          </button>
        )}
      </div>

      {/* paper roll area */}
      <div className="flex-1 overflow-y-auto flex flex-col items-center py-4 gap-0">
        {/* spacer so content starts at bottom when short */}
        <div className="flex-1" />

        {/* paper */}
        <div
          className="bg-[#faf9f7] shadow-lg font-mono text-[#1a1a1a] overflow-hidden"
          style={{
            width: `${PRINTER_COLS}ch`,
            fontSize: "12px",
            letterSpacing: "0px",
            minHeight: "1px",
          }}
        >
          {entries.length === 0 ? (
            <div className="flex items-center justify-center h-16 text-[#c8bfaf] text-xs">
              (buffer vacío)
            </div>
          ) : (
            <div className="px-0">
              {entries.map((entry) => (
                <PrinterEntry key={entry.id} entry={entry} animate={newIds.has(entry.id)} />
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* tear-off bottom */}
        {entries.length > 0 && (
          <div
            className="bg-[#faf9f7]"
            style={{
              width: `${PRINTER_COLS}ch`,
              height: "8px",
              backgroundImage:
                "repeating-linear-gradient(90deg, #faf9f7 0 8px, #c8bfaf 8px 10px)",
            }}
          />
        )}
      </div>
    </div>
  );
}
