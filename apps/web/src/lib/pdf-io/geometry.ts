import type { Rect } from "@margin/annotation-model";

/**
 * Conversion between PDF user space and the annotation model's space (ARCHITECTURE §4).
 *
 * PDF user space: points, origin bottom-left, y up, `/Rotate` NOT applied, positions measured in
 * the page's default user space (so a CropBox that does not start at 0,0 shifts everything).
 * Model space: points relative to the page CropBox, unrotated, origin top-left, y down.
 *
 * `/Rotate` therefore never enters the math: annotation coordinates in the file are in unrotated
 * user space, and so are ours. It only decides how a viewer turns the page when drawing it.
 */

/** The visible page box in user space: CropBox clipped to the MediaBox (what PDF.js calls `view`). */
export interface PageBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** A user-space rect (any corner order, `[x, y, x, y]`) to a model rect. */
export function pdfRectToRect(rect: readonly number[], box: PageBox): Rect {
  const [ax = 0, ay = 0, bx = 0, by = 0] = rect;
  return [
    Math.min(ax, bx) - box.x0,
    box.y1 - Math.max(ay, by),
    Math.max(ax, bx) - box.x0,
    box.y1 - Math.min(ay, by),
  ];
}

/** A model rect to a user-space `/Rect` `[llx, lly, urx, ury]`. */
export function rectToPdfRect(rect: Rect, box: PageBox): [number, number, number, number] {
  return [
    round3(box.x0 + rect[0]),
    round3(box.y1 - rect[3]),
    round3(box.x0 + rect[2]),
    round3(box.y1 - rect[1]),
  ];
}

/**
 * `/QuadPoints` to model rects, one per quad. Writers disagree on the point order inside a quad
 * (the spec says counter-clockwise, Acrobat and everyone else write a Z), so the rect is the
 * bounding box of the four points, which is right for every order.
 */
export function quadPointsToRects(quads: readonly number[], box: PageBox): Rect[] {
  const rects: Rect[] = [];
  for (let i = 0; i + 7 < quads.length; i += 8) {
    const xs = [0, 2, 4, 6].map((k) => quads[i + k] as number);
    const ys = [1, 3, 5, 7].map((k) => quads[i + k] as number);
    rects.push(
      pdfRectToRect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], box),
    );
  }
  return rects;
}

/**
 * Model rects to `/QuadPoints`: 8 numbers per rect in the order Acrobat, Preview, Chrome and
 * Zotero all read as upper-left, upper-right, lower-left, lower-right ("Z" order), even though the
 * spec's own text says counter-clockwise.
 */
export function rectsToQuadPoints(rects: readonly Rect[], box: PageBox): number[] {
  return rects.flatMap((rect) => {
    const [llx, lly, urx, ury] = rectToPdfRect(rect, box);
    return [llx, ury, urx, ury, llx, lly, urx, lly];
  });
}

/** Bounding `/Rect` of several model rects. */
export function boundsOf(rects: readonly Rect[]): Rect {
  return [
    Math.min(...rects.map((r) => r[0])),
    Math.min(...rects.map((r) => r[1])),
    Math.max(...rects.map((r) => r[2])),
    Math.max(...rects.map((r) => r[3])),
  ];
}

/** CropBox clipped to the MediaBox, both as `[x, y, width, height]` like pdf-lib returns them. */
export function visibleBox(
  media: { x: number; y: number; width: number; height: number },
  crop: { x: number; y: number; width: number; height: number },
): PageBox {
  const x0 = Math.max(media.x, crop.x);
  const y0 = Math.max(media.y, crop.y);
  const x1 = Math.min(media.x + media.width, crop.x + crop.width);
  const y1 = Math.min(media.y + media.height, crop.y + crop.height);
  return x1 > x0 && y1 > y0
    ? { x0, y0, x1, y1 }
    : { x0: media.x, y0: media.y, x1: media.x + media.width, y1: media.y + media.height };
}
