import { useEffect, useLayoutEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { ditherGray, type ImageEffect } from "@printer/core/dither";

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
  | { id: string; type: "image"; src: string; effect?: ImageEffect }
  | { id: string; type: "qr"; text: string; errorLevel?: "L"|"M"|"Q"|"H"; size?: number }
  | { id: string; type: "barcode"; data: string; height: number; format?: string }
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

function processCanvas(img: HTMLImageElement, effect: ImageEffect = "photo"): string {
  const W = 384;
  const H = Math.round((img.naturalHeight / img.naturalWidth) * W);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;

  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = 0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!;
  }

  ditherGray(gray, W, H, effect as Parameters<typeof ditherGray>[3]);

  for (let i = 0; i < W * H; i++) {
    const v = gray[i]! < 128 ? 0 : 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return canvas.toDataURL("image/png");
}

// ─── Entry Renderers ─────────────────────────────────────────────────────────

const COLS_PER_SIZE: Record<number, number> = { 1: 32, 2: 17, 3: 10, 4: 8 };

function wrapLine(text: string, cols: number): string[] {
  if (text.length <= cols) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += cols) out.push(text.slice(i, i + cols));
  return out;
}

function TextLine({ entry }: { entry: Extract<PrintEntry, { type: 'text' }> }) {
  const cols  = COLS_PER_SIZE[entry.size] ?? Math.max(1, Math.floor(PRINTER_COLS / entry.size));
  const lines = entry.text.split('\n').flatMap(l => wrapLine(l, cols));

  const alignClass =
    entry.align === 'center' ? 'text-center' :
    entry.align === 'right'  ? 'text-right'  : 'text-left';

  return (
    <div
      className={alignClass}
      style={{
        fontSize: `${entry.size * 0.75}rem`,
        fontWeight: entry.bold ? 'bold' : 'normal',
        lineHeight: 1.15,
        whiteSpace: 'pre',
        ...(entry.invert
          ? { background: '#1a1a1a', color: '#f5f0e8', padding: '0 2px' }
          : {}),
      }}
    >
      {lines.map((line, i) => (
        <div key={i}>{line || ' '}</div>
      ))}
    </div>
  );
}

function ImageLine({ entry }: { entry: Extract<PrintEntry, { type: "image" }> }) {
  const isSvg = entry.src.startsWith("data:image/svg");
  const [processed, setProcessed] = useState<string | null>(null);

  useEffect(() => {
    if (isSvg) return;
    const img = new Image();
    img.onload = () => setProcessed(processCanvas(img, entry.effect ?? "photo"));
    img.src = entry.src;
  }, [entry.src, entry.effect, isSvg]);

  // SVGs (ticket/card previews) render directly — dithering would destroy the vector artwork
  if (isSvg) return <img src={entry.src} alt="" className="w-full" />;

  if (!processed) return (
    <img src={entry.src} alt="" className="w-full"
      style={{ imageRendering: "pixelated", filter: "grayscale(1) contrast(2)" }} />
  );

  return (
    <img src={processed} alt="" className="w-full"
      style={{ imageRendering: "pixelated" }} />
  );
}

function QrLine({ entry }: { entry: Extract<PrintEntry, { type: "qr" }> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, entry.text, {
      width: 192,
      margin: 2,
      errorCorrectionLevel: entry.errorLevel ?? "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
  }, [entry.text, entry.errorLevel]);

  return (
    <div className="flex justify-center">
      <canvas ref={canvasRef} style={{ imageRendering: "pixelated", maxWidth: "100%", height: "auto" }} />
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

function PrinterEntry({ entry, animate, afterCut }: { entry: PrintEntry; animate: boolean; afterCut?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!animate || !ref.current) return;
    const el = ref.current;
    let started = false;

    el.style.height = "0px";
    el.style.overflow = "hidden";

    function start() {
      if (started) return;
      // scrollHeight returns natural content height even when the element itself is height:0
      const h = el.scrollHeight;
      if (!h) return;
      started = true;
      ro.disconnect();
      const ms = Math.max(80, h / PRINT_SPEED);
      requestAnimationFrame(() => {
        el.style.transition = `height ${ms}ms linear`;
        el.style.height = `${h}px`;
        el.addEventListener("transitionend", () => {
          el.style.height = "";
          el.style.overflow = "";
          el.style.transition = "";
        }, { once: true });
      });
    }

    const ro = new ResizeObserver(start);
    // Observe img elements directly — ResizeObserver fires when they gain dimensions after load
    const imgs = el.querySelectorAll("img");
    if (imgs.length) imgs.forEach(img => ro.observe(img));
    else ro.observe(el);

    requestAnimationFrame(start); // works immediately for text; images fall back to ResizeObserver

    return () => { started = true; ro.disconnect(); };
  }, [animate]);

  return (
    <div ref={ref} className={afterCut ? "pt-1" : undefined}>
      <EntryRenderer entry={entry} />
    </div>
  );
}

// ─── PrinterBuffer ────────────────────────────────────────────────────────────

interface Props {
  entries: PrintEntry[];
  onClear?: () => void;
  disableAnimation?: boolean;
  previewEntries?: PrintEntry[];
}

export function PrinterBuffer({ entries, onClear, disableAnimation, previewEntries = [] }: Props) {
  const printedRef = useRef<HTMLDivElement>(null);
  const knownIds   = useRef(new Set<string>());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  // Track whether the user has scrolled away from the bottom
  const stuckToBottom = useRef(true);

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

  function scrollToBottom() {
    const el = printedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  // Scroll to bottom whenever a new entry is added (immediate — before animation)
  useEffect(() => {
    if (stuckToBottom.current) scrollToBottom();
  }, [entries.length]);

  const paperRef = useRef<HTMLDivElement>(null);

  // Also keep scrolled to bottom while animations grow content
  useEffect(() => {
    const scroll = printedRef.current;
    const paper  = paperRef.current;
    if (!scroll || !paper) return;
    const ro = new ResizeObserver(() => {
      if (stuckToBottom.current) scroll.scrollTop = scroll.scrollHeight;
    });
    ro.observe(paper);
    return () => ro.disconnect();
  }, []);


  const [showJumpBtn, setShowJumpBtn] = useState(false);

  function handleScroll() {
    const el = printedRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    stuckToBottom.current = atBottom;
    setShowJumpBtn(!atBottom && entries.length > 0);
  }

  const hasEntries = entries.length > 0;
  const hasPreview = previewEntries.length > 0;

  const paperStyle    = { width: `calc(${PRINTER_COLS}ch + 12px)`, fontSize: "12px", letterSpacing: "0px", paddingLeft: "6px", paddingRight: "6px", paddingTop: "6px" };
  const previewStyle  = { ...paperStyle, paddingTop: undefined, paddingBottom: "6px" };

  // palette refs — warm neutrals from the theme
  const C = {
    bg:       "oklch(0.900 0.016 80)",   // surface-3
    toolbar:  "oklch(0.877 0.019 77)",   // surface-4
    border:   "oklch(0.800 0.018 74)",   // border
    paper:    "oklch(0.993 0.003 85)",   // surface-0 / input-bg
    paperTear:"oklch(0.900 0.016 80)",   // matches bg for tear strip
    preview:  "oklch(0.910 0.055 74)",   // amber-muted tint
    dimText:  "oklch(0.620 0.018 74)",   // muted-foreground-ish
    faintText:"oklch(0.750 0.014 74)",   // very faint label
    ink:      "oklch(0.11  0.006 75)",   // foreground
  };

  return (
    <div
      className="flex-shrink-0 flex flex-col h-full overflow-hidden border-l"
      style={{ fontFamily: "var(--font-mono)", fontSize: "12px", width: `calc(${PRINTER_COLS}ch + 3rem)`, background: C.bg, borderColor: C.border }}
    >
      {/* toolbar */}
      <div className="flex items-center justify-between px-3 py-2 flex-shrink-0 border-b"
        style={{ background: C.toolbar, borderColor: C.border }}>
        <span className="text-[10px] font-mono tracking-wide [font-variant-numeric:tabular-nums]" style={{ color: C.dimText }}>POS-58 · {PRINTER_COLS}col</span>
        {hasEntries && (
          <button onClick={onClear} className="text-[10px] transition-[color,transform] active:scale-[0.96]"
            style={{ color: C.dimText }}
            onMouseEnter={e => (e.currentTarget.style.color = C.ink)}
            onMouseLeave={e => (e.currentTarget.style.color = C.dimText)}>
            clear
          </button>
        )}
      </div>

      {/* ── Printed section ── */}
      <div className="flex-[3] min-h-0 flex flex-col border-b relative" style={{ borderColor: C.border }}>
      <div
        ref={printedRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center pt-4 pb-10"
      >
        <div
          ref={paperRef}
          className="font-mono overflow-hidden mt-auto flex-shrink-0"
          style={{ ...paperStyle, background: C.paper, color: C.ink, minHeight: "1px" }}
        >
          {!hasEntries ? (
            <div className="flex items-center justify-center h-16 text-xs" style={{ color: C.faintText }}>
              buffer vacío
            </div>
          ) : (
            <div>
              {entries.map((entry, i) => (
                <div key={entry.id}>
                  {i > 0 && entry.type !== "cut" && entries[i - 1]!.type !== "cut" && (
                    <div style={{ height: "18px", background: C.paper }} />
                  )}
                  <PrinterEntry
                    entry={entry}
                    animate={!disableAnimation && newIds.has(entry.id)}
                    afterCut={i > 0 && entries[i - 1]!.type === "cut"}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {hasEntries && (
          <div
            className="flex-shrink-0"
            style={{
              ...paperStyle,
              height: "8px",
              backgroundImage: `repeating-linear-gradient(90deg, ${C.paper} 0 8px, ${C.bg} 8px 10px)`,
            }}
          />
        )}
      </div>

      {/* Jump-to-bottom button — appears when user has scrolled up */}
      {showJumpBtn && (
        <button
          onClick={() => { stuckToBottom.current = true; setShowJumpBtn(false); scrollToBottom(); }}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] px-2.5 py-1 rounded-full transition-[color,transform] active:scale-[0.96]"
          style={{ background: C.toolbar, color: C.dimText, border: `1px solid ${C.border}` }}
          onMouseEnter={e => (e.currentTarget.style.color = C.ink)}
          onMouseLeave={e => (e.currentTarget.style.color = C.dimText)}
        >
          ↓ latest
        </button>
      )}
      </div>

      {/* ── Preview section ── */}
      <div className="flex-[2] min-h-0 flex flex-col">
        {/* Fixed label — never scrolls */}
        <div className="flex-shrink-0 flex items-center gap-2 px-3 py-3">
          <div className="flex-1 border-t border-dashed" style={{ borderColor: C.faintText }} />
          <span className="text-[9px] uppercase tracking-widest font-mono" style={{ color: C.faintText }}>preview</span>
          <div className="flex-1 border-t border-dashed" style={{ borderColor: C.faintText }} />
        </div>

        {/* Scrollable preview content */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center pb-3">
          {hasPreview ? (
            <div
              className="font-mono overflow-hidden flex-shrink-0"
              style={{ ...previewStyle, background: C.paper, color: C.ink }}
            >
              {previewEntries.map(entry => (
                <PrinterEntry key={entry.id} entry={entry} animate={false} />
              ))}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs" style={{ color: C.faintText }}>
              sin preview
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Inline preview (no scroll, no animation, for accordion use) ─────────────

export function PrintPreview({ entries }: { entries: PrintEntry[] }) {
  return (
    <div
      className="font-mono text-[#1a1a1a] overflow-hidden"
      style={{ width: `${PRINTER_COLS}ch`, fontSize: "12px", letterSpacing: "0px", background: "#faf9f7" }}
    >
      {entries.map(entry => (
        <PrinterEntry key={entry.id} entry={entry} animate={false} />
      ))}
    </div>
  );
}
