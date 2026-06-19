import { line437 } from "./encode437";

const ESC = 0x1b;
const GS  = 0x1d;

function u8(bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

export const cmd = {
  init:        () => u8([ESC, 0x40]),
  codepage437: () => u8([ESC, 0x74, 0x00]),
  alignLeft:   () => u8([ESC, 0x61, 0x00]),
  alignCenter: () => u8([ESC, 0x61, 0x01]),
  alignRight:  () => u8([ESC, 0x61, 0x02]),
  bold:        (on: boolean) => u8([ESC, 0x45, on ? 1 : 0]),
  underline:   (on: boolean) => u8([ESC, 0x2d, on ? 1 : 0]),
  // font: 0 = Font A (32 chars/line), 1 = Font B (42 chars/line)
  font:        (n: 0 | 1) => u8([ESC, 0x4d, n]),
  charSize:    (w: number, h: number) => u8([GS, 0x21, ((w - 1) << 4) | (h - 1)]),
  feed:        (lines: number) => u8([ESC, 0x64, lines]),
  cut:         () => u8([GS, 0x56, 0x00]),
  invert:      (on: boolean) => u8([GS, 0x42, on ? 1 : 0]),
  printSpeed:  (slow: boolean) => u8([ESC, 0x73, slow ? 1 : 0]),
};

export { line437 as line } from "./encode437";
