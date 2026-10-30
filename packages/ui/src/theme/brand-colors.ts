/**
 * Literal copies of two "Calm paper" light-theme tokens (styles/tokens.css) for places that can't
 * read CSS variables: the web app manifest and the browser `theme-color` meta tag.
 * `brand-colors.test.ts` fails if they drift from tokens.css.
 */
export const brandColors = {
  /** `--bg` */
  background: "#f7f5f0",
  /** `--accent` */
  accent: "#2c5f5a",
} as const;
