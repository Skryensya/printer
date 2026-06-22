export type ImageEffect = "photo" | "invert";

// Internal — includes legacy effects used for card/barcode/QR rendering
type _AnyEffect = ImageEffect | "dither" | "threshold" | "hicontrast";

function floydSteinberg(gray: Float32Array, W: number, H: number): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const old = gray[idx]!;
      const nw = old < 128 ? 0 : 255;
      gray[idx] = nw;
      const err = old - nw;
      if (x + 1 < W)               gray[idx + 1]!     += err * 7 / 16;
      if (y + 1 < H && x > 0)      gray[idx + W - 1]! += err * 3 / 16;
      if (y + 1 < H)                gray[idx + W]!     += err * 5 / 16;
      if (y + 1 < H && x + 1 < W)  gray[idx + W + 1]! += err * 1 / 16;
    }
  }
}

function atkinson(gray: Float32Array, W: number, H: number): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const old = gray[idx]!;
      const nw = old < 128 ? 0 : 255;
      gray[idx] = nw;
      const err = Math.floor((old - nw) / 8);
      if (x + 1 < W)               gray[idx + 1]!     += err;
      if (x + 2 < W)               gray[idx + 2]!     += err;
      if (y + 1 < H && x > 0)      gray[idx + W - 1]! += err;
      if (y + 1 < H)               gray[idx + W]!     += err;
      if (y + 1 < H && x + 1 < W)  gray[idx + W + 1]! += err;
      if (y + 2 < H)               gray[idx + W * 2]! += err;
    }
  }
}

function otsuThreshold(gray: Float32Array): number {
  const hist = new Float32Array(256);
  for (let i = 0; i < gray.length; i++) hist[Math.min(255, Math.max(0, Math.round(gray[i]!)))]!++;
  const total = gray.length;
  const sum = Array.from(hist).reduce((acc, h, i) => acc + i * h, 0);
  let sumB = 0, wB = 0, max = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const between = wB * wF * ((sumB / wB) - ((sum - sumB) / wF)) ** 2;
    if (between > max) { max = between; threshold = t; }
  }
  return threshold;
}

// Mutates gray in-place, producing 0/255 values for all pixels.
export function ditherGray(gray: Float32Array, width: number, height: number, effect: _AnyEffect): void {
  switch (effect) {
    case "photo": {
      // Pre-brighten (gamma 2.2) to compensate for thermal smearing, then Atkinson.
      for (let i = 0; i < gray.length; i++) gray[i] = Math.pow(gray[i]! / 255, 1 / 2.2) * 255;
      atkinson(gray, width, height);
      break;
    }
    case "dither": {
      // 3×3 block noise threshold — blocks survive thermal dot gain at 203 DPI.
      const B = 3;
      for (let by = 0; by < height; by += B)
        for (let bx = 0; bx < width; bx += B) {
          const noise = (Math.random() - 0.5) * 260;
          for (let dy = 0; dy < B && by + dy < height; dy++)
            for (let dx = 0; dx < B && bx + dx < width; dx++)
              gray[(by + dy) * width + (bx + dx)] =
                gray[(by + dy) * width + (bx + dx)]! + noise < 128 ? 0 : 255;
        }
      break;
    }
    case "threshold": {
      // Clamp to 1: pure-binary images (QR, barcode) make Otsu return 0,
      // which would map every pixel to white and produce a blank print.
      const t = Math.max(1, otsuThreshold(gray));
      for (let i = 0; i < gray.length; i++) gray[i] = gray[i]! >= t ? 255 : 0;
      break;
    }
    case "hicontrast": {
      // Aggressive S-curve (tanh × 2.5) then Floyd-Steinberg.
      for (let i = 0; i < gray.length; i++) {
        const x = (gray[i]! / 127.5) - 1;
        gray[i] = (Math.tanh(x * 2.5) + 1) / 2 * 255;
      }
      floydSteinberg(gray, width, height);
      break;
    }
    case "invert": {
      for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i]!;
      atkinson(gray, width, height);
      break;
    }
  }
}
