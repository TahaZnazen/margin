import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Rect } from "./target";
import { mergeLineRects, type PageView, pageToViewport, viewportToPage } from "./transforms";

const ROTATIONS = [0, 90, 180, 270] as const;
const ZOOMS = [0.5, 1, 2, 3] as const;
const TOLERANCE_PT = 0.5;

// Page sizes from a business card to A0, in points.
const pageSize = fc.record({
  pageWidth: fc.double({ min: 100, max: 2400, noNaN: true }),
  pageHeight: fc.double({ min: 100, max: 3400, noNaN: true }),
});

/** A rect inside a page of the given size. */
const rectOnPage = (width: number, height: number) =>
  fc
    .tuple(
      fc.double({ min: 0, max: width, noNaN: true }),
      fc.double({ min: 0, max: height, noNaN: true }),
      fc.double({ min: 0, max: width, noNaN: true }),
      fc.double({ min: 0, max: height, noNaN: true }),
    )
    .map(([a, b, c, d]): Rect => [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]);

const pageAndRect = pageSize.chain((size) =>
  fc.record({ size: fc.constant(size), rect: rectOnPage(size.pageWidth, size.pageHeight) }),
);

const within = (actual: Rect, expected: Rect, tolerance: number) =>
  actual.every((value, i) => Math.abs(value - (expected[i] as number)) <= tolerance);

describe("pageToViewport / viewportToPage", () => {
  for (const rotation of ROTATIONS) {
    for (const scale of ZOOMS) {
      it(`round-trips within ${TOLERANCE_PT} pt at rotation ${rotation}, zoom ${scale}`, () => {
        fc.assert(
          fc.property(pageAndRect, ({ size, rect }) => {
            const view: PageView = { ...size, rotation, scale };
            const back = viewportToPage(pageToViewport(rect, view), view);
            expect(within(back, rect, TOLERANCE_PT)).toBe(true);
          }),
        );
      });

      it(`keeps rects inside the rotated viewport at rotation ${rotation}, zoom ${scale}`, () => {
        fc.assert(
          fc.property(pageAndRect, ({ size, rect }) => {
            const view: PageView = { ...size, rotation, scale };
            const quarterTurn = rotation === 90 || rotation === 270;
            const width = (quarterTurn ? size.pageHeight : size.pageWidth) * scale;
            const height = (quarterTurn ? size.pageWidth : size.pageHeight) * scale;
            const [x1, y1, x2, y2] = pageToViewport(rect, view);
            const eps = 1e-6;
            expect(x1 >= -eps && y1 >= -eps && x2 <= width + eps && y2 <= height + eps).toBe(true);
            expect(x1 <= x2 && y1 <= y2).toBe(true);
          }),
        );
      });
    }
  }

  // A 600 × 800 pt page with a 100 × 20 pt rect near its top-left corner.
  const page = { pageWidth: 600, pageHeight: 800 };
  const rect: Rect = [10, 20, 110, 40];

  it.each([
    [0, [10, 20, 110, 40]],
    // Clockwise quarter turn: the viewport is 800 wide, the rect lands near the top-right.
    [90, [760, 10, 780, 110]],
    [180, [490, 760, 590, 780]],
    // Three quarter turns: near the bottom-left.
    [270, [20, 490, 40, 590]],
  ] as const)("maps a known rect at rotation %i", (rotation, expected) => {
    expect(pageToViewport(rect, { ...page, rotation, scale: 1 })).toEqual(expected);
    expect(viewportToPage([...expected], { ...page, rotation, scale: 1 })).toEqual(rect);
  });

  it("scales by the zoom factor", () => {
    expect(pageToViewport(rect, { ...page, rotation: 0, scale: 2 })).toEqual([20, 40, 220, 80]);
  });

  it("rejects a rotation that isn't a quarter turn", () => {
    const view = { ...page, rotation: 45, scale: 1 } as unknown as PageView;
    expect(() => pageToViewport(rect, view)).toThrow(RangeError);
    expect(() => viewportToPage(rect, view)).toThrow(RangeError);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects scale %s", (scale) => {
    const view: PageView = { ...page, rotation: 0, scale };
    expect(() => pageToViewport(rect, view)).toThrow(RangeError);
    expect(() => viewportToPage(rect, view)).toThrow(RangeError);
  });
});

describe("mergeLineRects", () => {
  /** Character boxes for `count` glyphs on one line, starting at x. */
  const glyphs = (x: number, top: number, count: number, width = 6, height = 12): Rect[] =>
    Array.from(
      { length: count },
      (_, i): Rect => [x + i * width, top, x + (i + 1) * width, top + height],
    );

  it("returns nothing for nothing", () => {
    expect(mergeLineRects([])).toEqual([]);
  });

  it("merges the glyphs of a line into one rect", () => {
    expect(mergeLineRects(glyphs(72, 100, 10))).toEqual([[72, 100, 132, 112]]);
  });

  it("returns one rect per line for a selection over three lines", () => {
    const boxes = [...glyphs(200, 100, 5), ...glyphs(72, 114, 20), ...glyphs(72, 128, 3)];
    expect(mergeLineRects(boxes)).toEqual([
      [200, 100, 230, 112],
      [72, 114, 192, 126],
      [72, 128, 90, 140],
    ]);
  });

  it("absorbs glyphs that sit a little higher or lower (superscripts, mixed fonts)", () => {
    const boxes: Rect[] = [...glyphs(72, 100, 3), [90, 96, 95, 104], ...glyphs(95, 100, 2)];
    expect(mergeLineRects(boxes)).toEqual([[72, 96, 107, 112]]);
  });

  it("keeps two columns apart on the same baseline", () => {
    const boxes = [...glyphs(72, 100, 5), ...glyphs(320, 100, 5)];
    expect(mergeLineRects(boxes)).toEqual([
      [72, 100, 102, 112],
      [320, 100, 350, 112],
    ]);
  });

  it("merges right-to-left glyph order too", () => {
    const boxes = glyphs(72, 100, 4).reverse();
    expect(mergeLineRects(boxes)).toEqual([[72, 100, 96, 112]]);
  });

  it("normalizes boxes given with swapped corners", () => {
    expect(mergeLineRects([[20, 30, 10, 5]])).toEqual([[10, 5, 20, 30]]);
  });

  const box = fc
    .tuple(
      fc.double({ min: 0, max: 600, noNaN: true }),
      fc.double({ min: 0, max: 800, noNaN: true }),
      fc.double({ min: 0, max: 40, noNaN: true }),
      fc.double({ min: 0, max: 20, noNaN: true }),
    )
    .map(([x, y, w, h]): Rect => [x, y, x + w, y + h]);

  const contains = (outer: Rect, inner: Rect) =>
    outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];

  it("never shrinks the covered area: every input box lies inside an output rect", () => {
    fc.assert(
      fc.property(fc.array(box, { maxLength: 60 }), (boxes) => {
        const merged = mergeLineRects(boxes);
        expect(boxes.every((b) => merged.some((m) => contains(m, b)))).toBe(true);
      }),
    );
  });

  it("never returns more rects than it was given", () => {
    fc.assert(
      fc.property(fc.array(box, { maxLength: 60 }), (boxes) => {
        expect(mergeLineRects(boxes).length).toBeLessThanOrEqual(boxes.length);
      }),
    );
  });

  it("merges any run of touching glyphs on one line into a single rect", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 400, noNaN: true }),
        fc.double({ min: 0, max: 700, noNaN: true }),
        fc.integer({ min: 1, max: 80 }),
        (x, top, count) => {
          expect(mergeLineRects(glyphs(x, top, count))).toHaveLength(1);
        },
      ),
    );
  });
});
