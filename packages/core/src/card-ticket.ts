import QRCode from "qrcode";

// ── Public type ───────────────────────────────────────────────────────────────

export interface CardData {
  title?:  string;
  badge?:  string;           // outlined pill, top-left (e.g. priority short-name)
  from?:   string;           // sender name — shown if no badge
  label?:  string;           // secondary text next to badge/from (e.g. "TASK #001")
  date?:   string;           // right-aligned in header
  rows?:   [string, string, string?][];  // meta rows: [label, value] or [icon, name, qty] for 3-col
  qr?:     string;           // QR code data — if set, body shows QR instead of title+meta
}

// ── Layout constants ──────────────────────────────────────────────────────────

const TOTAL_W   = 384;
const CARD_X    = 3;
const CARD_Y    = 4;
const CARD_W    = TOTAL_W - CARD_X * 2;   // 378
const BR        = 14;
const PAD       = 18;
const CONTENT_W = CARD_W - PAD * 2;       // 342

// HEADER_H is computed dynamically per card — see computeHeaderH()
const TITLE_FS  = 24;
const TITLE_LH  = 33;
const META_FS   = 20;
const META_LH   = 26;
const LABEL_FS  = 13;
const META_ROW_H = LABEL_FS + 5 + META_FS + 14; // label + gap + value + bottom padding
const BADGE_FS  = 22;
const FROM_FS   = 32;
const DATE_FS   = 20;

const FONT = "system-ui,-apple-system,Helvetica Neue,Arial,sans-serif";

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(text: string, maxW: number, fs: number): string[] {
  // 0.60 is conservative for mixed-case proportional fonts — prevents overflow past the clip boundary
  const cw    = fs * 0.60;
  const max   = Math.floor(maxW / cw);
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    // Break words longer than one line across multiple lines (e.g. URLs)
    let remaining = w;
    while (remaining.length > max) {
      const available = max - (cur ? cur.length + 1 : 0);
      if (available > 0 && cur) {
        // Fill the rest of the current line
        cur += " " + remaining.slice(0, available);
        remaining = remaining.slice(available);
        lines.push(cur);
        cur = "";
      } else {
        if (cur) { lines.push(cur); cur = ""; }
        lines.push(remaining.slice(0, max));
        remaining = remaining.slice(max);
      }
    }
    const word = remaining;
    if (!word) continue;
    if (!cur) {
      cur = word;
    } else if (cur.length + 1 + word.length <= max) {
      cur += " " + word;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function buildQrRects(text: string, x0: number, y0: number, size: number): string[] {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n  = qr.modules.size;
  const m  = size / n;
  const out: string[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (qr.modules.get(row, col)) {
        out.push(
          `  <rect x="${(x0 + col * m).toFixed(1)}" y="${(y0 + row * m).toFixed(1)}" width="${m.toFixed(2)}" height="${m.toFixed(2)}" fill="#111"/>`,
        );
      }
    }
  }
  return out;
}

// ── Header height ─────────────────────────────────────────────────────────────

const BADGE_H      = 38;
const MIN_HEADER_H = PAD + BADGE_H + PAD; // 74px — comfortable single-line floor

function computeHeaderH(card: CardData): number {
  if (card.badge) {
    if (card.label) {
      const nLines = wrapText(card.label, CONTENT_W, TITLE_FS).length;
      const labelH = TITLE_FS + (nLines - 1) * TITLE_LH;
      return Math.max(MIN_HEADER_H, PAD + BADGE_H + 10 + labelH + PAD);
    }
    return MIN_HEADER_H;
  }
  if (card.from) {
    const nLines = wrapText(card.from, CONTENT_W, FROM_FS).length;
    const fromH  = FROM_FS + (nLines - 1) * (FROM_FS + 4);
    return Math.max(MIN_HEADER_H, PAD + 14 + 8 + fromH + PAD);
  }
  if (card.label) {
    const nLines  = wrapText(card.label, CONTENT_W, TITLE_FS).length;
    const labelH  = TITLE_FS + (nLines - 1) * TITLE_LH;
    return Math.max(MIN_HEADER_H, PAD + labelH + PAD);
  }
  return MIN_HEADER_H;
}

// ── SVG builder ───────────────────────────────────────────────────────────────

export function renderCardSVG(card: CardData): string {
  const HEADER_H   = computeHeaderH(card);
  const headerMidY = CARD_Y + HEADER_H / 2;
  const rightEdge  = CARD_X + CARD_W - PAD;

  // ── Header left element ───────────────────────────────────────────────────

  const leftElements: string[] = [];
  let labelX = CARD_X + PAD;

  if (card.badge) {
    // Row 1: badge pill (top-left) — date is right-aligned on the same row
    const badgeW  = card.badge.length * 14 + 32;
    const row1Y   = CARD_Y + PAD;
    const badgeTY = row1Y + BADGE_H / 2 + BADGE_FS * 0.35;
    leftElements.push(
      `  <rect x="${CARD_X + PAD}" y="${row1Y.toFixed(1)}" width="${badgeW.toFixed(1)}" height="${BADGE_H}" rx="10" fill="white" stroke="#111" stroke-width="2"/>`,
      `  <text x="${(CARD_X + PAD + badgeW / 2).toFixed(1)}" y="${badgeTY.toFixed(1)}" font-family="${FONT}" font-size="${BADGE_FS}" font-weight="700" fill="#111" text-anchor="middle">${esc(card.badge)}</text>`,
    );
    // Row 2: label below badge — wraps if long
    if (card.label) {
      const labelLines = wrapText(card.label, CONTENT_W, TITLE_FS);
      const row2BaseY  = row1Y + BADGE_H + 10 + TITLE_FS;
      leftElements.push(
        ...labelLines.map((line, i) =>
          `  <text x="${CARD_X + PAD}" y="${(row2BaseY + i * TITLE_LH).toFixed(1)}" font-family="${FONT}" font-size="${TITLE_FS}" font-weight="700" fill="#111">${esc(line)}</text>`
        ),
      );
    }
    labelX = CARD_X + CARD_W; // date handled separately, label consumed above
  } else if (card.from) {
    const fromLabelY  = CARD_Y + PAD + 14;
    const fromBaseY   = fromLabelY + 8 + FROM_FS;
    const fromLines   = wrapText(card.from, CONTENT_W, FROM_FS);
    leftElements.push(
      `  <text x="${CARD_X + PAD}" y="${fromLabelY.toFixed(1)}" font-family="${FONT}" font-size="16" font-weight="700" fill="#111" letter-spacing="2">FROM</text>`,
      ...fromLines.map((line, i) =>
        `  <text x="${CARD_X + PAD}" y="${(fromBaseY + i * (FROM_FS + 4)).toFixed(1)}" font-family="${FONT}" font-size="${FROM_FS}" font-weight="600" fill="#111">${esc(line)}</text>`
      ),
    );
    labelX = CARD_X + CARD_W;
  } else if (card.label) {
    // Standalone header label — centered vertically, wraps if long
    const labelLines  = wrapText(card.label, CONTENT_W, TITLE_FS);
    const blockH      = TITLE_FS + (labelLines.length - 1) * TITLE_LH;
    const firstLineY  = CARD_Y + (HEADER_H - blockH) / 2 + TITLE_FS * 0.85;
    leftElements.push(
      ...labelLines.map((line, i) =>
        `  <text x="${CARD_X + PAD}" y="${(firstLineY + i * TITLE_LH).toFixed(1)}" font-family="${FONT}" font-size="${TITLE_FS}" font-weight="700" fill="#111">${esc(line)}</text>`
      ),
    );
    labelX = CARD_X + CARD_W; // consumed — don't render secondary label
  }


  // ── Date (right-aligned) ──────────────────────────────────────────────────

  const dateY = card.from
    ? (CARD_Y + PAD + 14).toFixed(1)
    : card.badge
    ? (CARD_Y + PAD + BADGE_H / 2 + DATE_FS * 0.35).toFixed(1)   // align to badge pill center
    : (headerMidY + DATE_FS * 0.35).toFixed(1);
  const dateEl = card.date
    ? `  <text x="${rightEdge.toFixed(1)}" y="${dateY}" font-family="${FONT}" font-size="${DATE_FS}" font-weight="700" fill="#111" text-anchor="end">${esc(card.date)}</text>`
    : null;

  // ── Body ─────────────────────────────────────────────────────────────────

  const div1Y = CARD_Y + HEADER_H;

  let bodyElements: string[] = [];
  let bodyH: number;

  if (card.qr) {
    // QR body: centered square + optional title label below
    const qrSize    = CONTENT_W;                              // fill content width
    const qrX       = CARD_X + PAD;
    const qrY       = div1Y + 1 + PAD;
    const titleLines = card.title ? wrapText(card.title, CONTENT_W, TITLE_FS) : [];
    const titleH    = titleLines.length > 0 ? PAD + titleLines.length * TITLE_LH + PAD : PAD;
    bodyH           = PAD + qrSize + titleH;

    bodyElements = [
      // White background behind QR (in case clip cuts corner)
      `  <rect x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" fill="white"/>`,
      ...buildQrRects(card.qr, qrX, qrY, qrSize),
      ...(card.title
        ? wrapText(card.title, CONTENT_W, TITLE_FS).map((line, i) =>
            `  <text x="${(CARD_X + CARD_W / 2).toFixed(1)}" y="${(qrY + qrSize + PAD + TITLE_FS + i * TITLE_LH).toFixed(1)}" font-family="${FONT}" font-size="${TITLE_FS}" fill="#555" text-anchor="middle">${esc(line)}</text>`
          )
        : []),
    ];
  } else {
    // Text body: optional title + optional meta/list rows
    const hasTitle   = !!card.title?.trim();
    const hasMeta    = (card.rows?.length ?? 0) > 0;
    const titleLines = hasTitle ? wrapText(card.title!, CONTENT_W, TITLE_FS) : [];
    const titleH     = hasTitle ? 16 + titleLines.length * TITLE_LH + 16 : 0;

    // Per-row height: 3-col rows are inline wrapping; 2-col rows are stacked label+value
    const ROW_BOT    = 20; // bottom padding between rows
    const TODO_FS    = 24; // font-size for inline 3-col rows (larger than META_FS)
    const TODO_LH    = 30; // line height for 3-col rows
    const TODO_TOP   = 10; // top padding for 3-col rows
    const ICON_COL   = 46; // width reserved for "[ ]" checkbox column
    const QTY_COL    = 84; // width reserved for quantity on the right

    function nameWidth(hasQty: boolean): number {
      return CONTENT_W - ICON_COL - (hasQty ? QTY_COL : 0);
    }

    function rowHeight(row: [string, string, string?]): number {
      if (row[2] !== undefined) {
        const lines = wrapText(row[1], nameWidth(!!row[2]), TODO_FS).length;
        return TODO_TOP + lines * TODO_LH + ROW_BOT;
      }
      const valueLines = wrapText(row[1], CONTENT_W, META_FS).length;
      return LABEL_FS + 5 + valueLines * META_LH + ROW_BOT;
    }

    const metaH  = hasMeta ? 14 + card.rows!.reduce((acc, r) => acc + rowHeight(r), 0) : 0;
    bodyH        = titleH + metaH || 8;

    const titleY = div1Y + 1;
    const metaY  = titleY + titleH;

    bodyElements = [
      ...(hasTitle ? titleLines.map((tl, i) => {
        const ty = (titleY + 16 + TITLE_FS + i * TITLE_LH).toFixed(1);
        return `  <text x="${CARD_X + PAD}" y="${ty}" font-family="${FONT}" font-size="${TITLE_FS}" font-weight="600" fill="#111">${esc(tl)}</text>`;
      }) : []),
      ...(hasMeta ? card.rows!.flatMap((row, i) => {
        const rowTop = metaY + 14 + card.rows!.slice(0, i).reduce((acc, r) => acc + rowHeight(r), 0);
        const isLast = i === card.rows!.length - 1;

        if (row[2] !== undefined) {
          // ── 3-col inline: icon | name (wrapping) | qty ──────────────────────
          const [icon, name, qty] = row;
          const nameLines = wrapText(name, nameWidth(!!qty), TODO_FS);
          const firstBaseY = rowTop + TODO_TOP + TODO_FS * 0.85;
          const nameX      = CARD_X + PAD + ICON_COL;
          const divY       = rowTop + rowHeight(row);
          return [
            `  <text x="${CARD_X + PAD}" y="${firstBaseY.toFixed(1)}" font-family="${FONT}" font-size="${TODO_FS}" font-weight="700" fill="#333" letter-spacing="3">${esc(icon)}</text>`,
            ...nameLines.map((line, j) => {
              const ly = (firstBaseY + j * TODO_LH).toFixed(1);
              return `  <text x="${nameX}" y="${ly}" font-family="${FONT}" font-size="${TODO_FS}" font-weight="500" fill="#111">${esc(line)}</text>`;
            }),
            ...(qty ? [`  <text x="${(CARD_X + CARD_W - PAD).toFixed(1)}" y="${firstBaseY.toFixed(1)}" font-family="${FONT}" font-size="${TODO_FS - 4}" fill="#666" text-anchor="end">${esc(qty)}</text>`] : []),
            ...(!isLast ? [`  <line x1="${CARD_X + PAD}" y1="${divY.toFixed(1)}" x2="${CARD_X + CARD_W - PAD}" y2="${divY.toFixed(1)}" stroke="#999" stroke-width="2"/>`] : []),
          ];
        } else {
          // ── 2-col stacked: label (small) + value (large) ────────────────────
          const [label, value] = row;
          const valueLines = wrapText(value, CONTENT_W, META_FS);
          const labelY   = (rowTop + LABEL_FS).toFixed(1);
          const divY     = rowTop + rowHeight(row);
          return [
            `  <text x="${CARD_X + PAD}" y="${labelY}" font-family="${FONT}" font-size="${LABEL_FS}" font-weight="700" fill="#888" letter-spacing="1">${esc(label.toUpperCase())}</text>`,
            ...valueLines.map((vl, j) => {
              const vy = (rowTop + LABEL_FS + 5 + META_FS + j * META_LH).toFixed(1);
              return `  <text x="${CARD_X + PAD}" y="${vy}" font-family="${FONT}" font-size="${META_FS}" font-weight="500" fill="#111">${esc(vl)}</text>`;
            }),
            ...(!isLast ? [`  <line x1="${CARD_X + PAD}" y1="${divY.toFixed(1)}" x2="${CARD_X + CARD_W - PAD}" y2="${divY.toFixed(1)}" stroke="#eee" stroke-width="1"/>`] : []),
          ];
        }
      }) : []),
    ];
  }

  // ── Assemble ─────────────────────────────────────────────────────────────

  const CARD_H = HEADER_H + 1 + bodyH;
  const SVG_H  = CARD_Y + CARD_H + CARD_Y;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TOTAL_W}" height="${SVG_H}" viewBox="0 0 ${TOTAL_W} ${SVG_H}">`,
    `<defs><clipPath id="c"><rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_W}" height="${CARD_H}" rx="${BR}"/></clipPath></defs>`,

    `<rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_W}" height="${CARD_H}" rx="${BR}" fill="white" stroke="#111" stroke-width="2.5"/>`,

    `<g clip-path="url(#c)">`,

    ...leftElements,
    ...(dateEl ? [dateEl] : []),

    `  <line x1="${CARD_X}" y1="${div1Y}" x2="${CARD_X + CARD_W}" y2="${div1Y}" stroke="#111" stroke-width="2"/>`,

    ...bodyElements,

    `</g>`,
    `</svg>`,
  ].join("\n");
}
