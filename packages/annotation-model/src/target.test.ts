import { describe, expect, it } from "vitest";
import {
  AnnotationShape,
  AnnotationTarget,
  AreaTarget,
  BookmarkTarget,
  HighlightTarget,
  pageStart,
  Rect,
} from "./target";
import { DEFAULT_HIGHLIGHT_LABELS, HIGHLIGHT_COLORS } from "./vocabulary";

const fingerprint = `sha256:${"ab".repeat(32)}`;
const quote = { exact: "the exact words", prefix: "before ", suffix: " after" };

const highlight = {
  kind: "highlight",
  color: "key",
  quote_text: "the exact words",
  target: {
    fingerprint,
    segments: [
      { page: 41, rects: [[72, 310.5, 523.2, 324.1]], textPos: { start: 1203, end: 1288 } },
      { page: 42, rects: [[72, 60, 300, 74]] },
    ],
    quote,
  },
};

const area = {
  kind: "area",
  color: "example",
  quote_text: null,
  target: { fingerprint, segments: [{ page: 3, rects: [[100, 100, 300, 250]] }] },
};

const bookmark = {
  kind: "bookmark",
  color: null,
  quote_text: null,
  target: { fingerprint, segments: [{ page: 7, rects: [] }] },
};

const REMOVE = Symbol("remove");
type Container = Record<PropertyKey, unknown>;

/** A deep copy of `base` with the value at `path` replaced (or removed, with REMOVE). */
function edit(base: object, path: readonly PropertyKey[], value: unknown): unknown {
  const copy = structuredClone(base) as Container;
  let node = copy;
  for (const key of path.slice(0, -1)) node = node[key] as Container;
  const last = path.at(-1) as PropertyKey;
  if (value === REMOVE) delete node[last];
  else node[last] = value;
  return copy;
}

const seg0 = ["target", "segments", 0] as const;

describe("AnnotationShape (validates kind, color, target and quote_text together)", () => {
  it.each([
    ["highlight", highlight],
    ["area", area],
    ["bookmark", bookmark],
  ])("accepts a valid %s", (_kind, example) => {
    expect(AnnotationShape.safeParse(example).success).toBe(true);
  });

  it.each([
    [
      "a one-page highlight without textPos",
      edit(highlight, ["target", "segments"], [{ page: 0, rects: [[1, 2, 3, 4]] }]),
    ],
    ["an area without a color", edit(area, ["color"], REMOVE)],
    ["an area without quote_text", edit(area, ["quote_text"], REMOVE)],
    ["a bookmark marking a spot", edit(bookmark, [...seg0, "rects"], [[50, 60, 50, 60]])],
    ["a bookmark without color or quote_text", { kind: "bookmark", target: bookmark.target }],
    ["a highlight with a matching page_start", { ...highlight, page_start: 41 }],
  ])("accepts %s", (_name, example) => {
    expect(AnnotationShape.safeParse(example).success).toBe(true);
  });

  it.each([
    ["a highlight without a quote", edit(highlight, ["target", "quote"], REMOVE)],
    ["a highlight without quote_text", edit(highlight, ["quote_text"], null)],
    ["a highlight with empty quote_text", edit(highlight, ["quote_text"], "")],
    ["a highlight with an empty exact quote", edit(highlight, ["target", "quote", "exact"], "")],
    [
      "a highlight with 33 characters of prefix",
      edit(highlight, ["target", "quote", "prefix"], "x".repeat(33)),
    ],
    [
      "a highlight with 33 characters of suffix",
      edit(highlight, ["target", "quote", "suffix"], "x".repeat(33)),
    ],
    ["a highlight without a color", edit(highlight, ["color"], null)],
    ["a highlight with an unknown color", edit(highlight, ["color"], "yellow")],
    ["a highlight without segments", edit(highlight, ["target", "segments"], [])],
    ["a highlight segment without rects", edit(highlight, [...seg0, "rects"], [])],
    [
      "a highlight with two segments on one page",
      edit(highlight, ["target", "segments", 1, "page"], 41),
    ],
    [
      "a highlight with segments out of page order",
      edit(highlight, ["target", "segments", 1, "page"], 40),
    ],
    [
      "a highlight with textPos.end before textPos.start",
      edit(highlight, [...seg0, "textPos"], { start: 10, end: 9 }),
    ],
    [
      "an area with two rects",
      edit(
        area,
        [...seg0, "rects"],
        [
          [100, 100, 300, 250],
          [1, 1, 2, 2],
        ],
      ),
    ],
    ["an area with no rect", edit(area, [...seg0, "rects"], [])],
    [
      "an area with two segments",
      edit(
        area,
        ["target", "segments"],
        [
          { page: 3, rects: [[1, 1, 2, 2]] },
          { page: 4, rects: [[1, 1, 2, 2]] },
        ],
      ),
    ],
    ["an area with a quote", edit(area, ["target", "quote"], quote)],
    ["an area with quote_text", edit(area, ["quote_text"], "text")],
    ["an area with textPos", edit(area, [...seg0, "textPos"], { start: 1, end: 2 })],
    ["an area with an unknown color", edit(area, ["color"], "yellow")],
    ["a bookmark with a quote", edit(bookmark, ["target", "quote"], quote)],
    ["a bookmark with quote_text", edit(bookmark, ["quote_text"], "text")],
    ["a bookmark with a color", edit(bookmark, ["color"], "key")],
    [
      "a bookmark with two rects",
      edit(
        bookmark,
        [...seg0, "rects"],
        [
          [1, 1, 2, 2],
          [3, 3, 4, 4],
        ],
      ),
    ],
    ["a bookmark with textPos", edit(bookmark, [...seg0, "textPos"], { start: 1, end: 2 })],
    [
      "a bookmark with two segments",
      edit(
        bookmark,
        ["target", "segments"],
        [
          { page: 7, rects: [] },
          { page: 8, rects: [] },
        ],
      ),
    ],
    ["an ink annotation shaped like a bookmark", edit(bookmark, ["kind"], "ink")],
    ["an ink annotation shaped like an area", edit(area, ["kind"], "ink")],
    ["an unknown kind", edit(area, ["kind"], "underline")],
    ["a bad fingerprint", edit(area, ["target", "fingerprint"], "md5:abc")],
    [
      "an uppercase fingerprint",
      edit(area, ["target", "fingerprint"], `sha256:${"AB".repeat(32)}`),
    ],
    ["a negative page", edit(area, [...seg0, "page"], -1)],
    ["a fractional page", edit(area, [...seg0, "page"], 1.5)],
    ["a rect with x1 > x2", edit(area, [...seg0, "rects"], [[300, 100, 100, 250]])],
    ["a rect with y1 > y2", edit(area, [...seg0, "rects"], [[100, 250, 300, 100]])],
    ["a rect with three numbers", edit(area, [...seg0, "rects"], [[100, 100, 300]])],
    [
      "a rect with an infinite coordinate",
      edit(area, [...seg0, "rects"], [[100, 100, 300, Number.POSITIVE_INFINITY]]),
    ],
    ["a target with an unknown field", edit(bookmark, ["target", "note"], "x")],
    ["a page_start other than the first segment's page", { ...highlight, page_start: 42 }],
    ["a negative page_start", { ...bookmark, page_start: -1 }],
  ])("rejects %s", (_name, example) => {
    expect(AnnotationShape.safeParse(example).success).toBe(false);
  });

  it("strips row fields it doesn't check", () => {
    const parsed = AnnotationShape.parse({ ...bookmark, comment: "kept elsewhere" });
    expect(parsed).not.toHaveProperty("comment");
  });
});

describe("per-kind target schemas", () => {
  it("accept their own kind's example", () => {
    expect(HighlightTarget.safeParse(highlight.target).success).toBe(true);
    expect(AreaTarget.safeParse(area.target).success).toBe(true);
    expect(BookmarkTarget.safeParse(bookmark.target).success).toBe(true);
  });

  it("reject the other kinds' examples", () => {
    expect(HighlightTarget.safeParse(area.target).success).toBe(false);
    expect(AreaTarget.safeParse(highlight.target).success).toBe(false);
    expect(AreaTarget.safeParse(bookmark.target).success).toBe(false);
    expect(BookmarkTarget.safeParse(highlight.target).success).toBe(false);
  });

  it("AnnotationTarget accepts any kind's target", () => {
    for (const example of [highlight, area, bookmark]) {
      expect(AnnotationTarget.safeParse(example.target).success).toBe(true);
    }
  });

  it("Rect accepts a zero-size point", () => {
    expect(Rect.safeParse([5, 5, 5, 5]).success).toBe(true);
  });
});

describe("pageStart", () => {
  it("is the first segment's page", () => {
    expect(pageStart(HighlightTarget.parse(highlight.target))).toBe(41);
    expect(pageStart(BookmarkTarget.parse(bookmark.target))).toBe(7);
  });
});

describe("highlight colors", () => {
  it("has a default label for each of the 5 colors", () => {
    expect(Object.keys(DEFAULT_HIGHLIGHT_LABELS)).toEqual([...HIGHLIGHT_COLORS]);
    expect(DEFAULT_HIGHLIGHT_LABELS).toEqual({
      key: "Key idea",
      definition: "Definition",
      example: "Example",
      memorize: "Memorize",
      confusing: "Confusing",
    });
  });
});
