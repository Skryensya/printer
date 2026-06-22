function u8(bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

// ESC/POS GS k (Function B): 1D 6B m n d1..dn
const FORMAT_CODE: Record<BarcodeFormat, number> = {
  code128: 0x49, // Code128
  code39:  0x45, // Code39
  ean13:   0x43, // EAN-13
  ean8:    0x44, // EAN-8
  upca:    0x41, // UPC-A
};

export type BarcodeFormat = "code128" | "code39" | "ean13" | "ean8" | "upca";

export function buildBarcode(data: string, height = 80, format: BarcodeFormat = "code128"): Uint8Array[] {
  const bytes = new TextEncoder().encode(data);
  const m = FORMAT_CODE[format];
  return [
    u8([0x1D, 0x68, height]),
    u8([0x1D, 0x77, 0x02]),
    u8([0x1D, 0x48, 0x02]),
    u8([0x1D, 0x6B, m, bytes.length, ...bytes]),
  ];
}
