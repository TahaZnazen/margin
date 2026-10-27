import { describe, expect, it } from "vitest";
import { buildPageText, findInText, normalizeForSearch, rangeBoxes, runRect } from "./text";

const measure = (str: string, fontSize: number) => str.length * fontSize * 0.5;

const run = (str: string, x: number, y: number, extra = {}) => ({
  str,
  x,
  y,
  width: str.length * 5,
  fontSize: 10,
  ascent: 0.718,
  descent: 0.207,
  angle: 0,
  fontFamily: "sans-serif",
  dir: "ltr" as const,
  hasEOL: false,
  ...extra,
});

describe("text geometry", () => {
  it("builds page text with line breaks and run offsets", () => {
    const page = buildPageText([run("Hello", 0, 10, { hasEOL: true }), run("world", 0, 22)]);
    expect(page.text).toBe("Hello\nworld");
    expect(page.runs.map((r) => r.start)).toEqual([0, 6]);
  });

  it("boxes a whole run from ascender to descender", () => {
    const page = buildPageText([run("Hello", 72, 100)]);
    const [x0, y0, x1, y1] = runRect(page.runs[0] as never);
    expect([x0, x1]).toEqual([72, 97]);
    expect(y0).toBeCloseTo(100 - 7.18, 6);
    expect(y1).toBeCloseTo(100 + 2.07, 6);
  });

  it("cuts a partial run proportionally, and mirrors it for right-to-left", () => {
    const ltr = buildPageText([run("abcd", 0, 10)]);
    expect(rangeBoxes(ltr, 1, 3, measure)[0]?.[0]).toBeCloseTo(5);
    expect(rangeBoxes(ltr, 1, 3, measure)[0]?.[2]).toBeCloseTo(15);
    const rtl = buildPageText([run("abcd", 0, 10, { dir: "rtl" })]);
    expect(rangeBoxes(rtl, 0, 1, measure)[0]?.[0]).toBeCloseTo(15);
  });

  it("finds text ignoring case, accents, ligatures and line breaks", () => {
    expect(findInText("Les Éléphants\nsont ﬁers", "elephants sont")).toEqual([
      { start: 4, end: 18 },
    ]);
    expect(findInText("so ﬁne", "fine")).toEqual([{ start: 3, end: 6 }]);
    expect(findInText("abc", "  ")).toEqual([]);
  });

  it("maps normalized offsets back to the original", () => {
    const { text, map } = normalizeForSearch("É  b");
    expect(text).toBe("e b");
    expect(map).toEqual([0, 1, 3]);
  });
});
