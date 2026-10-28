/** Pure text geometry shared by the text layer, selection and find. No engine, no React. */
import type { Rect } from "@margin/annotation-model";
import type { PageText, TextRun } from "./engine";

/** Measures `str` at `fontSize` pt in `fontFamily`. Injected so tests run without a canvas. */
export type Measure = (str: string, fontSize: number, fontFamily: string) => number;

let ctx: CanvasRenderingContext2D | null = null;

/** Canvas-based measurement (browser only). */
export const canvasMeasure: Measure = (str, fontSize, fontFamily) => {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return 0;
  ctx.font = `100px ${fontFamily}`;
  return (ctx.measureText(str).width * fontSize) / 100;
};

const baselineCache = new Map<string, number>();

/** Offset of the baseline from the top of a `line-height: 1` box, as a fraction of the font size. */
export function baselineRatio(fontFamily: string): number {
  const cached = baselineCache.get(fontFamily);
  if (cached !== undefined) return cached;
  let ratio = 0.8;
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  if (ctx) {
    ctx.font = `100px ${fontFamily}`;
    const m = ctx.measureText("Ag");
    const a = m.fontBoundingBoxAscent / 100;
    const d = m.fontBoundingBoxDescent / 100;
    if (Number.isFinite(a) && Number.isFinite(d) && a + d > 0) ratio = 0.5 + (a - d) / 2;
  }
  baselineCache.set(fontFamily, ratio);
  return ratio;
}

/** Joins runs into the page text and stamps each run's `start`. */
export function buildPageText(runs: Omit<TextRun, "start">[]): PageText {
  let text = "";
  const out: TextRun[] = [];
  for (const run of runs) {
    out.push({ ...run, start: text.length });
    text += run.str;
    if (run.hasEOL) text += "\n";
  }
  return { text, runs: out };
}

/** The parts of a PDF.js `TextContent` this module reads (kept structural: no pdfjs import). */
export interface RawTextContent {
  items: readonly unknown[];
  styles: Record<string, { ascent?: number; descent?: number; fontFamily?: string } | undefined>;
}

/** PDF.js text content to runs in page coordinates (CropBox, origin top-left). */
export function pageTextFromContent(content: RawTextContent, view: readonly number[]): PageText {
  const [x0 = 0, , , y1 = 0] = view;
  const runs: Omit<TextRun, "start">[] = [];
  for (const raw of content.items) {
    const item = raw as {
      str?: string;
      transform: number[];
      fontName: string;
      width: number;
      hasEOL: boolean;
      dir?: string;
    };
    if (typeof item.str !== "string") continue; // marked-content markers
    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = item.transform;
    const style = content.styles[item.fontName];
    const fontSize = Math.hypot(c, d) || Math.hypot(a, b);
    if (item.str === "" && !item.hasEOL) continue;
    runs.push({
      str: item.str,
      x: e - x0,
      y: y1 - f,
      width: item.width,
      fontSize,
      ascent: style?.ascent ?? 0.8,
      descent: Math.abs(style?.descent ?? -0.2),
      angle: (Math.atan2(b, a) * 180) / Math.PI,
      fontFamily: style?.fontFamily ?? "sans-serif",
      dir: item.dir === "rtl" ? "rtl" : "ltr",
      hasEOL: item.hasEOL,
    });
  }
  return buildPageText(runs);
}

/** Box of a whole run (AFM-style ascender to descender), axis-aligned. */
export function runRect(run: TextRun): Rect {
  const up = run.ascent * run.fontSize;
  const down = run.descent * run.fontSize;
  const corners: [number, number][] = [
    [0, -up],
    [run.width, -up],
    [run.width, down],
    [0, down],
  ];
  const rad = (run.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // y grows downward, so a counter-clockwise PDF angle rotates with -sin.
  const pts = corners.map(([cx, cy]) => [run.x + cx * cos + cy * sin, run.y - cx * sin + cy * cos]);
  const xs = pts.map((p) => p[0] as number);
  const ys = pts.map((p) => p[1] as number);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Box of characters [from, to) of a run. Partial runs are cut proportionally to measured glyph
 * widths, which is exactly how the text layer stretches the span to the run's width.
 */
export function runPartRect(run: TextRun, from: number, to: number, measure: Measure): Rect {
  const full = runRect(run);
  const len = run.str.length;
  if ((from <= 0 && to >= len) || run.angle !== 0 || len === 0) return full;
  const total = measure(run.str, run.fontSize, run.fontFamily);
  if (!(total > 0)) return full;
  const before = measure(run.str.slice(0, from), run.fontSize, run.fontFamily) / total;
  const upto = measure(run.str.slice(0, to), run.fontSize, run.fontFamily) / total;
  const [x0, y0, x1, y1] = full;
  const w = x1 - x0;
  return run.dir === "rtl"
    ? [x0 + w * (1 - upto), y0, x0 + w * (1 - before), y1]
    : [x0 + w * before, y0, x0 + w * upto, y1];
}

/** Boxes of the text between offsets [start, end) of a page, one per run (not yet merged). */
export function rangeBoxes(page: PageText, start: number, end: number, measure: Measure): Rect[] {
  const boxes: Rect[] = [];
  for (const run of page.runs) {
    const len = run.str.length;
    if (len === 0) continue;
    const from = Math.max(start, run.start) - run.start;
    const to = Math.min(end, run.start + len) - run.start;
    if (to > from) boxes.push(runPartRect(run, from, to, measure));
  }
  return boxes;
}

export interface NormalizedText {
  text: string;
  /** For each normalized code unit, the offset of the original code unit it came from. */
  map: number[];
}

const MARKS = /\p{M}/gu;

/** Lowercase, strip diacritics, expand ligatures, collapse whitespace; keeps an offset map. */
export function normalizeForSearch(source: string): NormalizedText {
  let text = "";
  const map: number[] = [];
  let lastSpace = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i] as string;
    let piece: string;
    if (/\s/.test(ch)) piece = " ";
    else piece = ch.normalize("NFKD").replace(MARKS, "").toLowerCase();
    for (const unit of piece) {
      if (unit === " ") {
        if (lastSpace || text.length === 0) continue;
        lastSpace = true;
      } else {
        lastSpace = false;
      }
      text += unit;
      for (let k = 0; k < unit.length; k++) map.push(i);
    }
  }
  return { text, map };
}

/** All hits of `query` in `pageText` as offsets [start, end) of the original text. */
export function findInText(pageText: string, query: string): { start: number; end: number }[] {
  const q = normalizeForSearch(query).text.trim();
  if (!q) return [];
  const { text, map } = normalizeForSearch(pageText);
  const hits: { start: number; end: number }[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(q, from);
    if (at < 0) break;
    const start = map[at] as number;
    const end = (map[at + q.length - 1] as number) + 1;
    hits.push({ start, end });
    from = at + q.length;
  }
  return hits;
}
