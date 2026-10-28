import type { HighlightTarget, Quote, Rect } from "./target";
import { onSameLine } from "./transforms";

/**
 * Highlights never overlap: these pure helpers decide whether two highlight targets share text,
 * whether one sits inside the other, and what the union of several looks like. They use the
 * `textPos` hint when both sides have it and fall back to the rects (imported highlights have no
 * `textPos`).
 */
type Segment = HighlightTarget["segments"][number];

/** Boxes touching by less than this many points on an axis don't count as overlapping. */
const EPS = 0.5;
/** Slack for "inside": rects built from the same text agree to well under a point. */
const INSIDE_SLACK = 1;

function rectsOverlap(a: Rect, b: Rect): boolean {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  const minH = Math.min(a[3] - a[1], b[3] - b[1]);
  return w > EPS && h > Math.max(EPS, minH * 0.4);
}

function rectInside(inner: Rect, outer: Rect): boolean {
  return (
    inner[0] >= outer[0] - INSIDE_SLACK &&
    inner[2] <= outer[2] + INSIDE_SLACK &&
    inner[1] >= outer[1] - INSIDE_SLACK &&
    inner[3] <= outer[3] + INSIDE_SLACK
  );
}

function segmentsOverlap(a: Segment, b: Segment): boolean {
  if (a.textPos && b.textPos)
    return a.textPos.start < b.textPos.end && b.textPos.start < a.textPos.end;
  return a.rects.some((p) => b.rects.some((q) => rectsOverlap(p, q)));
}

function segmentInside(inner: Segment, outer: Segment): boolean {
  if (inner.textPos && outer.textPos) {
    return inner.textPos.start >= outer.textPos.start && inner.textPos.end <= outer.textPos.end;
  }
  return inner.rects.every((r) => outer.rects.some((o) => rectInside(r, o)));
}

/** True when the two highlights cover some of the same text. */
export function targetsOverlap(a: HighlightTarget, b: HighlightTarget): boolean {
  return a.segments.some((s) => b.segments.some((t) => t.page === s.page && segmentsOverlap(s, t)));
}

/** True when everything `inner` covers lies within `outer`. */
export function targetInside(inner: HighlightTarget, outer: HighlightTarget): boolean {
  return inner.segments.every((s) =>
    outer.segments.some((t) => t.page === s.page && segmentInside(s, t)),
  );
}

function firstKey(t: HighlightTarget): [number, number, number] {
  const seg = t.segments[0];
  const pos = seg.textPos?.start;
  const rect = seg.rects[0];
  return [seg.page, pos ?? Number.NaN, rect ? rect[1] * 1e4 + rect[0] : 0];
}

function byPosition(a: HighlightTarget, b: HighlightTarget): number {
  const [pa, ta, ga] = firstKey(a);
  const [pb, tb, gb] = firstKey(b);
  if (pa !== pb) return pa - pb;
  if (!(Number.isNaN(ta) || Number.isNaN(tb)) && ta !== tb) return ta - tb;
  return ga - gb;
}

/** One rect per line from rects given in reading order, whatever the order of the pieces. */
function mergeAll(ordered: Rect[]): Rect[] {
  const items = ordered.map((rect, order) => ({ rect, order }));
  let again = true;
  while (again) {
    again = false;
    outer: for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (!(a && b && onSameLine(a.rect, b.rect))) continue;
        a.rect = [
          Math.min(a.rect[0], b.rect[0]),
          Math.min(a.rect[1], b.rect[1]),
          Math.max(a.rect[2], b.rect[2]),
          Math.max(a.rect[3], b.rect[3]),
        ];
        a.order = Math.min(a.order, b.order);
        items.splice(j, 1);
        again = true;
        break outer;
      }
    }
  }
  return items.sort((x, y) => x.order - y.order).map((it) => it.rect);
}

function joinText(
  a: { text: string; start?: number; end?: number },
  b: { text: string; start?: number; end?: number },
): string {
  if (a.text.includes(b.text)) return a.text;
  if (b.text.includes(a.text)) return b.text;
  let k = 0;
  if (a.start !== undefined && a.end !== undefined && b.start !== undefined) {
    const exact = a.end - b.start;
    if (exact > 0 && exact <= b.text.length && a.text.endsWith(b.text.slice(0, exact))) k = exact;
  }
  if (k === 0) {
    for (let n = Math.min(a.text.length, b.text.length); n > 0; n--) {
      if (a.text.endsWith(b.text.slice(0, n))) {
        k = n;
        break;
      }
    }
  }
  return k > 0 ? a.text + b.text.slice(k) : `${a.text} ${b.text}`;
}

/**
 * The union of overlapping highlights as one target: per page the rects are merged into one rect
 * per line, `textPos` spans the min..max when every piece has it, and the quote is the pieces'
 * text with their shared part counted once.
 */
export function unionTargets(targets: readonly HighlightTarget[]): HighlightTarget {
  const pieces = [...targets].sort(byPosition);
  const first = pieces[0];
  if (!first) throw new RangeError("unionTargets needs at least one target");

  const pages = [...new Set(pieces.flatMap((t) => t.segments.map((s) => s.page)))].sort(
    (a, b) => a - b,
  );
  const segments = pages.map((page) => {
    const parts = pieces.flatMap((t) => t.segments.filter((s) => s.page === page));
    const rects = mergeAll(parts.flatMap((s) => s.rects));
    const withPos = parts.filter((s) => s.textPos);
    const textPos =
      withPos.length === parts.length
        ? {
            start: Math.min(...parts.map((s) => s.textPos?.start ?? 0)),
            end: Math.max(...parts.map((s) => s.textPos?.end ?? 0)),
          }
        : undefined;
    return textPos ? { page, rects, textPos } : { page, rects };
  });

  // Quote: fold the pieces left to right; the context comes from whichever piece reaches furthest.
  const single = (t: HighlightTarget) => (t.segments.length === 1 ? t.segments[0] : undefined);
  let exact = first.quote.exact;
  let prefix = first.quote.prefix;
  let suffix = first.quote.suffix;
  let span = single(first)?.textPos;
  for (const piece of pieces.slice(1)) {
    const seg = single(piece);
    const joined = joinText(
      { text: exact, start: span?.start, end: span?.end },
      { text: piece.quote.exact, start: seg?.textPos?.start, end: seg?.textPos?.end },
    );
    if (joined === piece.quote.exact && joined !== exact) {
      prefix = piece.quote.prefix;
      suffix = piece.quote.suffix;
    } else if (joined !== exact) {
      suffix = piece.quote.suffix;
    }
    exact = joined;
    span =
      span && seg?.textPos
        ? {
            start: Math.min(span.start, seg.textPos.start),
            end: Math.max(span.end, seg.textPos.end),
          }
        : undefined;
  }
  const quote: Quote = { exact, prefix, suffix };
  return {
    fingerprint: first.fingerprint,
    segments: segments as HighlightTarget["segments"],
    quote,
  };
}
