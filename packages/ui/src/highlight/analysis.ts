import {
  contrast,
  type Deficiency,
  deltaEOk,
  hexToRgb,
  invert,
  multiply,
  over,
  type Rgb,
  scale,
  simulate,
} from "../lib/color";
import {
  FILL_DARK_ALPHA,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_PALETTE,
  type HighlightColor,
} from "./palette";

/**
 * How a PDF page looks under each reader theme (see docs/design/reader-layout.md, "Page rendering").
 * Text is the page's own ink: body text in PDFs is black or near-black.
 */
export const PAGE_TINT_SEPIA = "#f4ecd8";
export const PAGE_DIM_BRIGHTNESS = 0.8;
export const PAGE_INVERT_AMOUNT = 0.9;

export type PageMode = "light" | "sepia" | "dark-dimmed" | "dark-inverted";
export const PAGE_MODES: readonly PageMode[] = ["light", "sepia", "dark-dimmed", "dark-inverted"];

/** Worst realistic text inks: pure black and a dark grey used by many typeset PDFs. */
export const TEXT_INKS = ["#000000", "#333333"] as const;

const WHITE: Rgb = [1, 1, 1];

function renderPage(ink: Rgb, mode: PageMode): { paper: Rgb; ink: Rgb } {
  switch (mode) {
    case "light":
      return { paper: WHITE, ink };
    case "sepia": {
      const tint = hexToRgb(PAGE_TINT_SEPIA);
      return { paper: multiply(WHITE, tint), ink: multiply(ink, tint) };
    }
    case "dark-dimmed":
      return { paper: scale(WHITE, PAGE_DIM_BRIGHTNESS), ink: scale(ink, PAGE_DIM_BRIGHTNESS) };
    case "dark-inverted":
      return { paper: invert(WHITE, PAGE_INVERT_AMOUNT), ink: invert(ink, PAGE_INVERT_AMOUNT) };
  }
}

/** Paper and ink colors after the highlight is composited over them. */
export function highlighted(color: HighlightColor, mode: PageMode, inkHex: string) {
  const swatch = HIGHLIGHT_PALETTE[color];
  const page = renderPage(hexToRgb(inkHex), mode);
  if (mode === "light" || mode === "sepia") {
    const fill = hexToRgb(swatch.fillLight);
    return { paper: multiply(page.paper, fill), ink: multiply(page.ink, fill) };
  }
  const fill = hexToRgb(swatch.fillDark);
  return {
    paper: over(page.paper, fill, FILL_DARK_ALPHA),
    ink: over(page.ink, fill, FILL_DARK_ALPHA),
  };
}

/** Contrast of page text under the highlight, for the worst of the text inks. */
export function textContrast(color: HighlightColor, mode: PageMode): number {
  return Math.min(
    ...TEXT_INKS.map((ink) => {
      const { paper, ink: text } = highlighted(color, mode, ink);
      return contrast(paper, text);
    }),
  );
}

/** Contrast of the underline against the un-highlighted page paper. */
export function underlineContrast(color: HighlightColor, mode: PageMode): number {
  const swatch = HIGHLIGHT_PALETTE[color];
  const { paper } = renderPage(hexToRgb("#000000"), mode);
  const underline =
    mode === "light" || mode === "sepia" ? swatch.underlineLight : swatch.underlineDark;
  return contrast(paper, hexToRgb(underline));
}

/** How far the highlighted paper is from the plain paper (is the highlight visible at all?). */
export function fillVisibility(color: HighlightColor, mode: PageMode): number {
  const { paper } = renderPage(hexToRgb("#000000"), mode);
  return deltaEOk(paper, highlighted(color, mode, "#000000").paper);
}

export type Vision = "normal" | Deficiency;
export const VISIONS: readonly Vision[] = ["normal", "protanopia", "deuteranopia", "tritanopia"];

function seen(rgb: Rgb, vision: Vision): Rgb {
  return vision === "normal" ? rgb : simulate(rgb, vision);
}

export interface PairDistance {
  a: HighlightColor;
  b: HighlightColor;
  deltaE: number;
}

/** Smallest pairwise OKLab distance between the five colors as rendered, under a vision type. */
export function minPairDistance(
  sample: (color: HighlightColor) => Rgb,
  vision: Vision,
): PairDistance {
  let worst: PairDistance | undefined;
  for (const [i, a] of HIGHLIGHT_COLORS.entries()) {
    for (const b of HIGHLIGHT_COLORS.slice(i + 1)) {
      const deltaE = deltaEOk(seen(sample(a), vision), seen(sample(b), vision));
      if (!worst || deltaE < worst.deltaE) worst = { a, b, deltaE };
    }
  }
  if (!worst) throw new Error("No colors");
  return worst;
}

export const SAMPLES = {
  "fill on light page": (c: HighlightColor) => highlighted(c, "light", "#000000").paper,
  "fill on sepia page": (c: HighlightColor) => highlighted(c, "sepia", "#000000").paper,
  "fill on dimmed page": (c: HighlightColor) => highlighted(c, "dark-dimmed", "#000000").paper,
  "fill on inverted page": (c: HighlightColor) => highlighted(c, "dark-inverted", "#000000").paper,
  "chip (light UI)": (c: HighlightColor) => hexToRgb(HIGHLIGHT_PALETTE[c].chipLight),
  "chip (dark UI)": (c: HighlightColor) => hexToRgb(HIGHLIGHT_PALETTE[c].chipDark),
} as const satisfies Record<string, (c: HighlightColor) => Rgb>;
