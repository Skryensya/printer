function u8(bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

export function buildBarcode(data: string, height = 80): Uint8Array[] {
  const bytes = new TextEncoder().encode(data);
  return [
    u8([0x1D, 0x68, height]),
    u8([0x1D, 0x77, 0x02]),
    u8([0x1D, 0x48, 0x02]),
    u8([0x1D, 0x6B, 0x49, bytes.length, ...bytes]),
  ];
}
