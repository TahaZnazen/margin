import { Geist, Geist_Mono, Newsreader, Source_Sans_3, Source_Serif_4 } from "next/font/google";

// Self-hosted at build time by next/font (no runtime requests to Google). All SIL OFL 1.1.
// The CSS variables feed --font-ui / --font-title / --font-num in packages/ui tokens.css.

// Direction candidate "paper"
const paperUi = Source_Sans_3({ subsets: ["latin"], variable: "--font-paper-ui", display: "swap" });
const paperTitle = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-paper-title",
  display: "swap",
});

// Direction candidate "graphite" (not preloaded: only /dev pages use it until the pick)
const graphiteUi = Geist({
  subsets: ["latin"],
  variable: "--font-graphite-ui",
  display: "swap",
  preload: false,
});
const graphiteTitle = Newsreader({
  subsets: ["latin"],
  variable: "--font-graphite-title",
  display: "swap",
  preload: false,
});
const graphiteNum = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-graphite-num",
  display: "swap",
  preload: false,
});

export const fontVariables = [paperUi, paperTitle, graphiteUi, graphiteTitle, graphiteNum]
  .map((font) => font.variable)
  .join(" ");
