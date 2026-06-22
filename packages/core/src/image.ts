import sharp from "sharp";
import QRCode from "qrcode";
import bwipjs from "bwip-js/node";
import type { BarcodeFormat } from "./barcode";
import { renderCardSVG, type CardData } from "./card-ticket";
import { ditherGray, type ImageEffect } from "./dither";
export type { ImageEffect } from "./dither";

// Broader internal type — "threshold" is used for SVG/barcode/QR rasterization
// but is not a public API option.
type _InternalEffect = ImageEffect | "dither" | "threshold" | "hicontrast";

const PRINT_WIDTH = 384;

// ─── Effect pipeline ──────────────────────────────────────────────────────────

function pixelsToRaster(data: Buffer, width: number, height: number, effect: _InternalEffect = "photo"): Uint8Array[] {
  // data is 3-channel RGB from Sharp (flatten + toColorspace removes alpha/extra channels)
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = 0.299 * data[i * 3]! + 0.587 * data[i * 3 + 1]! + 0.114 * data[i * 3 + 2]!;
  }

  ditherGray(gray, width, height, effect as Parameters<typeof ditherGray>[3]);

  // Pack into ESC/POS GS v 0 raster bitmap bands.
  // Cheap 58mm printers have a 4-8KB internal buffer. Sending the whole image
  // in one USB transfer overflows it — the overflow bytes are printed as text.
  // Splitting into ≤128-row bands (~6KB each) keeps every transfer within budget.
  const bytesPerRow = Math.ceil(width / 8);
  const BAND_ROWS = 128;
  const bands: Uint8Array[] = [];

  for (let rowStart = 0; rowStart < height; rowStart += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, height - rowStart);
    const band = new Uint8Array(8 + bytesPerRow * rows);
    band[0] = 0x1d; band[1] = 0x76; band[2] = 0x30; band[3] = 0x00;
    band[4] = bytesPerRow & 0xFF; band[5] = (bytesPerRow >> 8) & 0xFF;
    band[6] = rows       & 0xFF; band[7] = (rows      >> 8) & 0xFF;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < width; x++) {
        if (gray[(rowStart + y) * width + x]! < 128) {
          band[8 + y * bytesPerRow + Math.floor(x / 8)]! |= 0x80 >> (x % 8);
        }
      }
    }
    bands.push(band);
  }
  return bands;
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Force to sRGB 3-channel, PRINT_WIDTH wide.
// .flatten() removes alpha by compositing onto white.
// .toColorspace('srgb') handles grayscale / CMYK / wide-gamut inputs.
function toSharp(source: string | Buffer) {
  return sharp(source)
    .resize(PRINT_WIDTH, null, { fit: "contain", background: { r: 255, g: 255, b: 255 }, withoutEnlargement: false, kernel: "lanczos3" })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .toColorspace("srgb");
}

export async function buildImage(source: string | Buffer, effect: ImageEffect = "photo"): Promise<Uint8Array[]> {
  const { data, info } = await toSharp(source).raw().toBuffer({ resolveWithObject: true });
  return pixelsToRaster(data, info.width, info.height, effect);
}

const BWIPJS_FORMAT: Record<BarcodeFormat, string> = {
  code128: "code128",
  code39:  "code39",
  ean13:   "ean13",
  ean8:    "ean8",
  upca:    "upca",
};

export async function buildBarcodeImage(data: string, height = 80, format: BarcodeFormat = "code128"): Promise<Uint8Array[]> {
  const png = await bwipjs.toBuffer({
    bcid:        BWIPJS_FORMAT[format],
    text:        data,
    scale:       3,
    height:      Math.round(height / 8),
    includetext: true,
    textxalign:  "center",
    backgroundcolor: "ffffff",
    barcolor:    "000000",
    textcolor:   "000000",
  });
  const { data: raw, info } = await sharp(png)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(PRINT_WIDTH, null, { fit: "contain", background: { r: 255, g: 255, b: 255 }, withoutEnlargement: false, kernel: "nearest" })
    .toColorspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return pixelsToRaster(raw, info.width, info.height, "threshold");
}

export async function buildCardTicket(card: CardData): Promise<Uint8Array[]> {
  const svg = renderCardSVG(card);
  const { data, info } = await sharp(Buffer.from(svg, "utf8"))
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .toColorspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return pixelsToRaster(data, info.width, info.height, "threshold");
}

export async function buildQRImage(text: string): Promise<Uint8Array[]> {
  for (let scale = 14; scale >= 4; scale--) {
    const png = await QRCode.toBuffer(text, {
      scale, margin: 1, errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
    const { width } = await sharp(png).metadata();
    if (width! <= PRINT_WIDTH) {
      const { data, info } = await sharp(png)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .toColorspace("srgb")
        .raw()
        .toBuffer({ resolveWithObject: true });
      return pixelsToRaster(data, info.width, info.height, "threshold");
    }
  }
  throw new Error("QR code too large to fit on 58mm paper");
}
