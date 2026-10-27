/**
 * Small, dependency-free color math used to verify the design tokens:
 * WCAG 2.x contrast, CSS blend modes, colorblindness simulation and OKLab distance.
 * Colors are sRGB tuples with channels in 0..1.
 */

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) throw new Error(`Expected a #rrggbb color, got "${hex}"`);
  const n = Number.parseInt(match[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb
    .map((c) =>
      Math.round(clamp01(c) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toGamma(c: number): number {
  const x = clamp01(c);
  return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
}

/** WCAG 2.x relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** CSS `mix-blend-mode: multiply` of an opaque source over a backdrop (per channel, sRGB). */
export function multiply(backdrop: Rgb, source: Rgb): Rgb {
  return [backdrop[0] * source[0], backdrop[1] * source[1], backdrop[2] * source[2]];
}

/** Normal alpha compositing of `source` at `alpha` over an opaque `backdrop` (sRGB, as browsers do). */
export function over(backdrop: Rgb, source: Rgb, alpha: number): Rgb {
  return [
    source[0] * alpha + backdrop[0] * (1 - alpha),
    source[1] * alpha + backdrop[1] * (1 - alpha),
    source[2] * alpha + backdrop[2] * (1 - alpha),
  ];
}

/** Scales every channel, like CSS `filter: brightness(f)`. */
export function scale(rgb: Rgb, factor: number): Rgb {
  return [rgb[0] * factor, rgb[1] * factor, rgb[2] * factor];
}

/** CSS `filter: invert(amount)`. */
export function invert(rgb: Rgb, amount = 1): Rgb {
  return [
    amount * (1 - rgb[0]) + (1 - amount) * rgb[0],
    amount * (1 - rgb[1]) + (1 - amount) * rgb[1],
    amount * (1 - rgb[2]) + (1 - amount) * rgb[2],
  ];
}

export type Deficiency = "protanopia" | "deuteranopia" | "tritanopia";

/** Machado, Oliveira & Fernandes (2009), severity 1.0, applied in linear RGB. */
const CVD_MATRICES: Record<Deficiency, readonly (readonly [number, number, number])[]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export function simulate(rgb: Rgb, deficiency: Deficiency): Rgb {
  const lin = rgb.map(toLinear) as unknown as Rgb;
  const m = CVD_MATRICES[deficiency];
  const out = m.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]);
  return [toGamma(out[0] ?? 0), toGamma(out[1] ?? 0), toGamma(out[2] ?? 0)];
}

export type Oklab = readonly [number, number, number];

/** Björn Ottosson's OKLab. */
export function toOklab(rgb: Rgb): Oklab {
  const [r, g, b] = rgb.map(toLinear) as unknown as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Euclidean distance in OKLab (ΔE_OK). About 0.02 is a just-noticeable difference. */
export function deltaEOk(a: Rgb, b: Rgb): number {
  const [l1, a1, b1] = toOklab(a);
  const [l2, a2, b2] = toOklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
