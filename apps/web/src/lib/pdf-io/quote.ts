import { buildQuote, type Quote, type Rect } from "@margin/annotation-model";
import { type Measure, type PageText, runRect } from "@margin/reader";

export interface RectQuote {
  quote: Quote;
  /** Offsets of the quote in `PageText.text`. */
  start: number;
  end: number;
}

/** Cumulative width fractions of a run's characters, left to right (0 at the start, 1 at the end). */
function charEdges(
  run: PageText["runs"][number],
  measure: Measure,
): { edges: number[]; box: Rect } | null {
  const len = run.str.length;
  if (len === 0) return null;
  const box = runRect(run);
  const total = measure(run.str, run.fontSize, run.fontFamily);
  const edges: number[] = [0];
  for (let i = 1; i <= len; i++) {
    edges.push(
      total > 0 ? measure(run.str.slice(0, i), run.fontSize, run.fontFamily) / total : i / len,
    );
  }
  return { edges, box };
}

/**
 * The text under a set of model rects: every character whose center lies inside one of them.
 * Returns the span from the first to the last such character, as the selection code does, so the
 * quote of an imported highlight reads like one made by selecting. null when no text lies under
 * the rects (a scanned page, or a highlight on an image).
 */
export function quoteFromRects(
  page: PageText,
  rects: readonly Rect[],
  measure: Measure,
): RectQuote | null {
  let start = Number.POSITIVE_INFINITY;
  let end = -1;
  for (const run of page.runs) {
    const built = charEdges(run, measure);
    if (!built) continue;
    const { edges, box } = built;
    const [x0, y0, x1, y1] = box;
    const cy = (y0 + y1) / 2;
    const w = x1 - x0;
    for (let i = 0; i < run.str.length; i++) {
      const a = edges[i] as number;
      const b = edges[i + 1] as number;
      const mid = (a + b) / 2;
      const cx = run.dir === "rtl" ? x0 + w * (1 - mid) : x0 + w * mid;
      if (run.str[i]?.trim() === "") continue;
      if (rects.some((r) => cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3])) {
        start = Math.min(start, run.start + i);
        end = Math.max(end, run.start + i + 1);
      }
    }
  }
  if (end < 0) return null;
  return { quote: buildQuote(page.text, start, end), start, end };
}
