import { HIGHLIGHT_COLORS, type HighlightColor } from "@margin/annotation-model";
import { HIGHLIGHT_PALETTE } from "@margin/ui/highlight";

/** `#rrggbb` to 0..1 components. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** The `/C` written for a semantic color: the palette's light fill, which reads as a marker pen. */
export function colorToRgb(color: HighlightColor): [number, number, number] {
  return hexToRgb(HIGHLIGHT_PALETTE[color].fillLight);
}

/** PDF `/C` (gray, RGB or CMYK, 0..1) to RGB; null when absent or transparent. */
export function pdfColorToRgb(c: readonly number[] | undefined): [number, number, number] | null {
  if (!c || c.length === 0) return null;
  if (c.length === 1) return [c[0] as number, c[0] as number, c[0] as number];
  if (c.length === 3) return [c[0] as number, c[1] as number, c[2] as number];
  if (c.length === 4) {
    const [cy, m, y, k] = c as [number, number, number, number];
    return [(1 - cy) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
  }
  return null;
}

function hue([r, g, b]: [number, number, number]): { h: number; s: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : d / max };
}

const HUES = Object.fromEntries(
  HIGHLIGHT_COLORS.map((c) => [c, hue(hexToRgb(HIGHLIGHT_PALETTE[c].fillLight)).h]),
) as Record<HighlightColor, number>;

/**
 * The nearest semantic color by hue (yellow to key, green to definition, blue to example, purple
 * to memorize, red to confusing). Grays and missing colors become "key".
 */
export function nearestColor(rgb: [number, number, number] | null): HighlightColor {
  if (!rgb) return "key";
  const { h, s } = hue(rgb);
  if (s < 0.1) return "key";
  let best: HighlightColor = "key";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const c of HIGHLIGHT_COLORS) {
    const diff = Math.abs(h - HUES[c]);
    const d = Math.min(diff, 360 - diff);
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best;
}
