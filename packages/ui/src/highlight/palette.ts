/**
 * The five semantic highlight colors (docs/PRODUCT.md, "Semantic highlight colors").
 * Source of truth for docs/design/highlight-palette.md. The CSS variables in `styles/tokens.css`
 * must match (palette.test.ts enforces it).
 *
 * Values were found by a constrained search in OKLCH: each color stays within ±18° of its named
 * hue, meets every floor in `PALETTE_REQUIREMENTS`, and keeps the five colors apart under
 * protanopia, deuteranopia and tritanopia simulation.
 */

export const HIGHLIGHT_COLORS = ["key", "definition", "example", "memorize", "confusing"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface HighlightSwatch {
  /** Default user-facing name and meaning. */
  label: string;
  meaning: string;
  /** Number key that applies the color from the selection popover. */
  shortcut: "1" | "2" | "3" | "4" | "5";
  /** Opaque fill drawn over light and sepia pages with `mix-blend-mode: multiply`. */
  fillLight: string;
  /** Dark-mode fill, drawn with normal blending at `FILL_DARK_ALPHA` over dimmed or inverted pages. */
  fillDark: string;
  /** Underline under highlighted text on light and sepia pages. */
  underlineLight: string;
  /** Underline on dark-mode pages (dimmed or inverted). */
  underlineDark: string;
  /** Solid swatch for chips, dots and filters on light and sepia chrome. */
  chipLight: string;
  /** Solid swatch for chips, dots and filters on dark chrome. */
  chipDark: string;
}

/** Opacity of `fillDark`. */
export const FILL_DARK_ALPHA = 0.25;

export const HIGHLIGHT_PALETTE: Record<HighlightColor, HighlightSwatch> = {
  key: {
    label: "Yellow",
    meaning: "Key idea",
    shortcut: "1",
    fillLight: "#ffe788",
    fillDark: "#ad9100",
    underlineLight: "#8b7402",
    underlineDark: "#8f6b00",
    chipLight: "#998001",
    chipDark: "#e3c33b",
  },
  definition: {
    label: "Green",
    meaning: "Definition",
    shortcut: "2",
    fillLight: "#b3f7c0",
    fillDark: "#00d88e",
    underlineLight: "#006e30",
    underlineDark: "#297c50",
    chipLight: "#007b55",
    chipDark: "#66d88d",
  },
  example: {
    label: "Blue",
    meaning: "Example / evidence",
    shortcut: "3",
    fillLight: "#b9dafd",
    fillDark: "#2783d6",
    underlineLight: "#0d7dd3",
    underlineDark: "#1371cd",
    chipLight: "#037bd2",
    chipDark: "#60aaf2",
  },
  memorize: {
    label: "Purple",
    meaning: "Memorize",
    shortcut: "4",
    fillLight: "#d1b6f4",
    fillDark: "#601e93",
    underlineLight: "#8047b5",
    underlineDark: "#8853b0",
    chipLight: "#793bb0",
    chipDark: "#a170d4",
  },
  confusing: {
    label: "Red",
    meaning: "Confusing",
    shortcut: "5",
    fillLight: "#ffb9b3",
    fillDark: "#c83f3e",
    underlineLight: "#c33354",
    underlineDark: "#cb3a57",
    chipLight: "#be2320",
    chipDark: "#f66d67",
  },
};
