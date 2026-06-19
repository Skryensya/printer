import sharp from "sharp";
import QRCode from "qrcode";

const PRINT_WIDTH = 384; // 58mm at 203 DPI: 384 printable dots wide

function pixelsToRaster(data: Buffer, width: number, height: number): Uint8Array[] {
  const bytesPerRow = Math.ceil(width / 8);
  // Allocate a single buffer: 8-byte GS v 0 header + raster data
  const buf = new Uint8Array(8 + bytesPerRow * height);
  buf.set([
    0x1d, 0x76, 0x30, 0x00,
    bytesPerRow & 0xFF, (bytesPerRow >> 8) & 0xFF,
    height       & 0xFF, (height      >> 8) & 0xFF,
  ]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x]! < 128) {
        buf[8 + y * bytesPerRow + Math.floor(x / 8)]! |= 0x80 >> (x % 8);
      }
    }
  }
  return [buf];
}

function toSharp(source: string | Buffer) {
  return sharp(source)
    .resize(PRINT_WIDTH, null, { fit: "inside", kernel: "nearest" })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .grayscale()
    .raw();
}

export async function buildImage(source: string | Buffer): Promise<Uint8Array[]> {
  const { data, info } = await toSharp(source).toBuffer({ resolveWithObject: true });
  return pixelsToRaster(data, info.width, info.height);
}

export async function buildQRImage(text: string): Promise<Uint8Array[]> {
  for (let scale = 14; scale >= 4; scale--) {
    const png = await QRCode.toBuffer(text, {
      scale,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
    const { width } = await sharp(png).metadata();
    if (width! <= PRINT_WIDTH) {
      const { data, info } = await sharp(png)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return pixelsToRaster(data, info.width, info.height);
    }
  }
  throw new Error("QR code too large to fit on 58mm paper");
}
