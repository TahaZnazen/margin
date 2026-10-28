import { describe, expect, it } from "vitest";
import { targetInside, targetsOverlap, unionTargets } from "./overlap";
import type { HighlightTarget, Rect } from "./target";

const fingerprint = `sha256:${"ab".repeat(32)}`;
const TEXT = "alpha beta gamma delta epsilon zeta";

/** A one-line highlight over TEXT[start, end), 6 pt per character. */
function line(
  start: number,
  end: number,
  opts: { pos?: boolean; y?: number } = {},
): HighlightTarget {
  const y = opts.y ?? 100;
  const rect: Rect = [72 + start * 6, y, 72 + end * 6, y + 10];
  return {
    fingerprint,
    segments: [
      opts.pos === false
        ? { page: 0, rects: [rect] }
        : { page: 0, rects: [rect], textPos: { start, end } },
    ],
    quote: {
      exact: TEXT.slice(start, end),
      prefix: TEXT.slice(Math.max(0, start - 4), start),
      suffix: TEXT.slice(end, end + 4),
    },
  };
}

describe("targetsOverlap", () => {
  for (const pos of [true, false]) {
    const label = pos ? "with textPos" : "from rects only";
    it(`detects shared text (${label})`, () => {
      expect(targetsOverlap(line(0, 10, { pos }), line(6, 16, { pos }))).toBe(true);
      expect(targetsOverlap(line(0, 10, { pos }), line(10, 16, { pos }))).toBe(false);
      expect(targetsOverlap(line(0, 5, { pos }), line(12, 20, { pos }))).toBe(false);
    });
  }

  it("ignores another line and another page", () => {
    expect(targetsOverlap(line(0, 10, { pos: false }), line(0, 10, { pos: false, y: 115 }))).toBe(
      false,
    );
    const other = line(0, 10);
    other.segments[0].page = 3;
    expect(targetsOverlap(line(0, 10), other)).toBe(false);
  });
});

describe("targetInside", () => {
  it("is true for a selection within a highlight, false when it sticks out", () => {
    for (const pos of [true, false]) {
      expect(targetInside(line(6, 10, { pos }), line(0, 16, { pos }))).toBe(true);
      expect(targetInside(line(0, 16, { pos }), line(0, 16, { pos }))).toBe(true);
      expect(targetInside(line(6, 20, { pos }), line(0, 16, { pos }))).toBe(false);
    }
  });
});

describe("unionTargets", () => {
  it("joins two overlapping highlights into one line rect and one quote", () => {
    const u = unionTargets([line(12, 24), line(0, 16)]);
    expect(u.quote.exact).toBe(TEXT.slice(0, 24));
    expect(u.quote.prefix).toBe("");
    expect(u.quote.suffix).toBe(TEXT.slice(24, 28));
    expect(u.segments).toHaveLength(1);
    expect(u.segments[0].rects).toEqual([[72, 100, 72 + 24 * 6, 110]]);
    expect(u.segments[0].textPos).toEqual({ start: 0, end: 24 });
  });

  it("works without textPos (imported highlights)", () => {
    const u = unionTargets([line(0, 16, { pos: false }), line(10, 24, { pos: false })]);
    expect(u.quote.exact).toBe(TEXT.slice(0, 24));
    expect(u.segments[0].rects).toEqual([[72, 100, 72 + 24 * 6, 110]]);
    expect(u.segments[0].textPos).toBeUndefined();
  });

  it("a selection that swallows a highlight and a third one gives the whole span", () => {
    const u = unionTargets([line(8, 14), line(2, 20), line(18, 30)]);
    expect(u.quote.exact).toBe(TEXT.slice(2, 30));
    expect(u.segments[0].rects).toHaveLength(1);
  });

  it("keeps one rect per line across lines, in reading order", () => {
    const two = (a: number, b: number): HighlightTarget => {
      const t = line(a, b);
      t.segments[0].rects = [
        [72 + a * 6, 100, 300, 110],
        [72, 115, 72 + b * 6, 125],
      ];
      return t;
    };
    const u = unionTargets([two(10, 30), line(2, 14)]);
    expect(u.segments[0].rects).toHaveLength(2);
    expect(u.segments[0].rects[0]?.[1]).toBe(100);
    expect(u.segments[0].rects[1]?.[1]).toBe(115);
  });

  it("spans pages and rejects an empty list", () => {
    const a = line(0, 10);
    const b = line(0, 8);
    b.segments[0].page = 1;
    const u = unionTargets([a, b]);
    expect(u.segments.map((s) => s.page)).toEqual([0, 1]);
    expect(() => unionTargets([])).toThrow();
  });
});
