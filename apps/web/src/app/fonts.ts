import { Source_Sans_3, Source_Serif_4 } from "next/font/google";

// Self-hosted at build time by next/font (no runtime requests to Google). Both SIL OFL 1.1.
// The CSS variables feed --font-ui / --font-title in packages/ui tokens.css.
const ui = Source_Sans_3({ subsets: ["latin"], variable: "--font-ui-face", display: "swap" });
const title = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-title-face",
  display: "swap",
});

export const fontVariables = `${ui.variable} ${title.variable}`;
