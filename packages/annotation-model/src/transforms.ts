import type { Rect } from "./target";

/** Page rotation, clockwise, as in the PDF `/Rotate` entry (plus any viewer rotation). */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * How a page is shown. `pageWidth` and `pageHeight` are the unrotated CropBox size in PDF points;
 * `scale` is viewport pixels per PDF point (CSS pixels; the engine applies devicePixelRatio).
 */
export interface PageView {
  pageWidth: number;
  pageHeight: number;
  rotation: Rotation;
  scale: number;
}

type Point = [number, number];
type Turn = (x: number, y: number, width: number, height: number) => Point;

// Page space → rotated page space (both in points, origin top-left). A clockwise quarter turn
// sends the top-left corner to the top-right, so (x, y) → (height - y, x).
const TURN: Record<Rotation, Turn> = {
  0: (x, y) => [x, y],
  90: (x, y, _w, h) => [h - y, x],
  180: (x, y, w, h) => [w - x, h - y],
  270: (x, y, w) => [y, w - x],
};

// The inverse of TURN.
const UNTURN: Record<Rotation, Turn> = {
  0: (u, v) => [u, v],
  90: (u, v, _w, h) => [v, h - u],
  180: (u, v, w, h) => [w - u, h - v],
  270: (u, v, w) => [w - v, u],
};

function assertView(view: PageView): void {
  if (!Object.hasOwn(TURN, view.rotation)) {
    throw new RangeError(`rotation must be 0, 90, 180 or 270, got ${view.rotation}`);
  }
  if (!(Number.isFinite(view.scale) && view.scale > 0)) {
    throw new RangeError(`scale must be a positive number, got ${view.scale}`);
  }
}

function corners(rect: Rect, map: (x: number, y: number) => Point): Rect {
  const [ax, ay] = map(rect[0], rect[1]);
  const [bx, by] = map(rect[2], rect[3]);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

/** PDF page rect (points, unrotated) → viewport rect (pixels, rotated and scaled). */
export function pageToViewport(rect: Rect, view: PageView): Rect {
  assertView(view);
  const { pageWidth: w, pageHeight: h, rotation, scale } = view;
  const turn = TURN[rotation];
  return corners(rect, (x, y) => {
    const [u, v] = turn(x, y, w, h);
    return [u * scale, v * scale];
  });
}

/** Viewport rect (pixels, rotated and scaled) → PDF page rect (points, unrotated). */
export function viewportToPage(rect: Rect, view: PageView): Rect {
  assertView(view);
  const { pageWidth: w, pageHeight: h, rotation, scale } = view;
  const unturn = UNTURN[rotation];
  return corners(rect, (u, v) => unturn(u / scale, v / scale, w, h));
}

/**
 * Two boxes belong to the same line when they overlap vertically by at least half the shorter
 * one's height and sit within this many line heights of each other horizontally. The gap limit
 * keeps a selection across a column gutter as two rects.
 */
const MAX_GAP_IN_LINE_HEIGHTS = 1.5;

function onSameLine(line: Rect, box: Rect): boolean {
  const lineHeight = line[3] - line[1];
  const boxHeight = box[3] - box[1];
  const overlap = Math.min(line[3], box[3]) - Math.max(line[1], box[1]);
  const gap = Math.max(box[0] - line[2], line[0] - box[2]);
  return (
    overlap >= Math.min(lineHeight, boxHeight) / 2 &&
    gap <= Math.max(lineHeight, boxHeight) * MAX_GAP_IN_LINE_HEIGHTS
  );
}

/**
 * Merges per-character (or per-word) boxes, given in reading order, into one rect per line.
 * Every input box is contained in an output rect, so merging never shrinks the covered area.
 */
export function mergeLineRects(rects: readonly Rect[]): Rect[] {
  const lines: Rect[] = [];
  for (const rect of rects) {
    const box: Rect = [
      Math.min(rect[0], rect[2]),
      Math.min(rect[1], rect[3]),
      Math.max(rect[0], rect[2]),
      Math.max(rect[1], rect[3]),
    ];
    const line = lines.at(-1);
    if (line && onSameLine(line, box)) {
      lines[lines.length - 1] = [
        Math.min(line[0], box[0]),
        Math.min(line[1], box[1]),
        Math.max(line[2], box[2]),
        Math.max(line[3], box[3]),
      ];
    } else {
      lines.push(box);
    }
  }
  return lines;
}
