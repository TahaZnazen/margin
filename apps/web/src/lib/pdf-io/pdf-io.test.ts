import { existsSync, readFileSync } from "node:fs";
import {
  buildQuote,
  HIGHLIGHT_COLORS,
  type HighlightColor,
  mergeLineRects,
  type Rect,
} from "@margin/annotation-model";
import { fixturePath, manifest } from "@margin/fixtures";
import { type PageText, pageTextFromContent, rangeBoxes } from "@margin/reader";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { nearestColor } from "./colors";
import { type ExportableAnnotation, exportAnnotatedPdf } from "./export";
import {
  pdfRectToRect,
  quadPointsToRects,
  rectsToQuadPoints,
  rectToPdfRect,
  visibleBox,
} from "./geometry";
import { type ImportedHighlight, importFromPdf } from "./import";

/** Proportional-by-character measure: node has no canvas, and export/import must agree on one. */
const measure = (s: string) => s.length;

async function textReader(bytes: Uint8Array) {
  const pdf = await getDocument({
    data: bytes.slice(),
    useSystemFonts: true,
    verbosity: 0,
  }).promise;
  const cache = new Map<number, PageText>();
  return {
    pageCount: pdf.numPages,
    async pageText(index: number): Promise<PageText> {
      let t = cache.get(index);
      if (!t) {
        const page = await pdf.getPage(index + 1);
        t = pageTextFromContent(await page.getTextContent(), page.view as number[]);
        cache.set(index, t);
      }
      return t;
    },
    destroy: () => pdf.loadingTask.destroy(),
  };
}

const bytesOf = (id: string) => new Uint8Array(readFileSync(fixturePath(id)));
const maxDelta = (a: Rect, b: Rect) => Math.max(...a.map((v, i) => Math.abs(v - (b[i] as number))));

describe("geometry", () => {
  const box = { x0: 20, y0: 30, x1: 420, y1: 530 }; // CropBox offset from the origin

  it("maps user space to the top-left CropBox space and back", () => {
    expect(pdfRectToRect([120, 430, 220, 500], box)).toEqual([100, 30, 200, 100]);
    expect(rectToPdfRect([100, 30, 200, 100], box)).toEqual([120, 430, 220, 500]);
  });

  it("writes quads in Acrobat's upper-left, upper-right, lower-left, lower-right order", () => {
    expect(rectsToQuadPoints([[100, 30, 200, 100]], box)).toEqual([
      120, 500, 220, 500, 120, 430, 220, 430,
    ]);
  });

  it("reads quads in any point order", () => {
    const z = [120, 500, 220, 500, 120, 430, 220, 430];
    const ccw = [120, 430, 220, 430, 220, 500, 120, 500];
    expect(quadPointsToRects(z, box)).toEqual([[100, 30, 200, 100]]);
    expect(quadPointsToRects(ccw, box)).toEqual([[100, 30, 200, 100]]);
  });

  it("clips the CropBox to the MediaBox", () => {
    const media = { x: 0, y: 0, width: 300, height: 300 };
    expect(visibleBox(media, { x: 50, y: 50, width: 500, height: 100 })).toEqual({
      x0: 50,
      y0: 50,
      x1: 300,
      y1: 150,
    });
  });

  it("maps colors to the nearest semantic color by hue", () => {
    expect(nearestColor([1, 0.92, 0.23])).toBe("key");
    expect(nearestColor([0.3, 0.85, 0.4])).toBe("definition");
    expect(nearestColor([0.2, 0.5, 1])).toBe("example");
    expect(nearestColor([0.7, 0.3, 0.9])).toBe("memorize");
    expect(nearestColor([1, 0.2, 0.2])).toBe("confusing");
    expect(nearestColor(null)).toBe("key");
  });
});

describe("import of the generated annotations fixture", () => {
  const entry = manifest.entries.find((e) => e.id === "annotations");
  type Expected = {
    annotations: {
      subtype: string;
      color: number[];
      contents: string;
      quote?: string;
      rects: Rect[];
    }[];
  };
  const expected = (entry as unknown as { expected: Expected }).expected.annotations;

  it("reproduces highlights and the sticky note within 1 pt", async () => {
    const bytes = bytesOf("annotations");
    const text = await textReader(bytes);
    const items = await importFromPdf(bytes, text.pageText, measure);
    await text.destroy();

    const highlights = items.filter((i): i is ImportedHighlight => i.kind === "highlight");
    const bookmarks = items.filter((i) => i.kind === "bookmark");
    expect(highlights).toHaveLength(2);
    expect(bookmarks).toHaveLength(1);

    const [yellow, green, note] = expected;
    expect(highlights[0]?.color).toBe("key");
    expect(highlights[1]?.color).toBe("definition");
    expect(highlights[0]?.comment).toBe(yellow?.contents);
    expect(highlights[1]?.comment).toBe(green?.contents);
    expect(highlights[0]?.quote.exact).toBe(yellow?.quote);
    expect(highlights[1]?.quote.exact.replace(/\s+/g, " ")).toBe(green?.quote);
    for (const [got, want] of [
      [highlights[0], yellow],
      [highlights[1], green],
    ] as const) {
      expect(got?.rects).toHaveLength(want?.rects.length ?? -1);
      got?.rects.forEach((r, i) => {
        expect(maxDelta(r, want?.rects[i] as Rect)).toBeLessThanOrEqual(1);
      });
    }
    expect(bookmarks[0]?.comment).toBe(note?.contents);
    expect(maxDelta(bookmarks[0]?.rects[0] as Rect, note?.rects[0] as Rect)).toBeLessThanOrEqual(1);
  });
});

interface Original {
  page: number;
  color: HighlightColor;
  rects: Rect[];
  exact: string;
}

/** Highlights over real text on the first pages: a slice of one line, and a stretch over two. */
async function pickHighlights(
  text: Awaited<ReturnType<typeof textReader>>,
  pages: number[],
): Promise<Original[]> {
  const out: Original[] = [];
  let n = 0;
  for (const page of pages) {
    const pt = await text.pageText(page);
    const runs = pt.runs.filter((r) => r.angle === 0 && r.str.trim().length >= 20);
    const make = (start: number, end: number) => {
      while (/\s/.test(pt.text[start] ?? "")) start++;
      while (/\s/.test(pt.text[end - 1] ?? "")) end--;
      if (end <= start) return;
      const rects = mergeLineRects(rangeBoxes(pt, start, end, measure));
      out.push({
        page,
        color: HIGHLIGHT_COLORS[n++ % HIGHLIGHT_COLORS.length] as HighlightColor,
        rects,
        exact: buildQuote(pt.text, start, end).exact,
      });
    };
    const a = runs[0];
    if (a) make(a.start + 3, a.start + Math.min(a.str.length, 18));
    const b = runs[2];
    const c = runs[3];
    if (b && c && c.start > b.start) make(b.start + 2, c.start + Math.min(c.str.length, 12));
  }
  return out;
}

describe("round trip: export an annotated PDF, import it back", () => {
  const cases = [
    { id: "mixed-pages", pages: [0, 1, 2, 3, 4, 5] },
    { id: "ruler", pages: [0, 1] },
    { id: "two-column-paper", pages: [0, 1, 4] },
  ];
  for (const { id, pages } of cases) {
    const present = existsSync(fixturePath(id));
    it.skipIf(!present)(
      `${id}: every highlight returns within 1 pt with the same quote and color`,
      { timeout: 60_000 },
      async () => {
        const bytes = bytesOf(id);
        const source = await textReader(bytes);
        const originals = await pickHighlights(source, pages);
        await source.destroy();
        expect(originals.length).toBeGreaterThan(3);

        const annotations: ExportableAnnotation[] = originals.map((o, i) => ({
          id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          kind: "highlight",
          color: o.color,
          comment: i % 2 ? `comment ${i}` : null,
          updatedAt: "2026-10-28T10:00:00Z",
          segments: [{ page: o.page, rects: o.rects }],
        }));
        const exported = await exportAnnotatedPdf(bytes, annotations, "Margin test");

        const again = await textReader(exported);
        const items = await importFromPdf(exported, again.pageText, measure);
        await again.destroy();
        const back = items.filter((i): i is ImportedHighlight => i.kind === "highlight");
        expect(back).toHaveLength(originals.length);

        let worst = 0;
        originals.forEach((o, i) => {
          const got = back.find((b) => b.page === o.page && b.quote.exact === o.exact);
          expect(got, `quote on page ${o.page}: ${o.exact}`).toBeDefined();
          expect(got?.color).toBe(o.color);
          expect(got?.comment).toBe(annotations[i]?.comment ?? null);
          expect(got?.rects).toHaveLength(o.rects.length);
          got?.rects.forEach((r, k) => {
            worst = Math.max(worst, maxDelta(r, o.rects[k] as Rect));
          });
        });
        console.log(`ROUND_TRIP_MAX_ERR_PT ${id}: ${worst.toFixed(4)} over ${originals.length}`);
        expect(worst).toBeLessThanOrEqual(1);
      },
    );
  }

  it("replaces the file's own annotations instead of doubling them", async () => {
    const bytes = bytesOf("annotations");
    const exported = await exportAnnotatedPdf(bytes, [], "Margin", true);
    const text = await textReader(exported);
    const items = await importFromPdf(exported, text.pageText, measure);
    await text.destroy();
    expect(items).toHaveLength(0);
  });

  it("exports bookmarks as sticky notes that import as bookmarks", async () => {
    const bytes = bytesOf("ruler");
    const exported = await exportAnnotatedPdf(bytes, [
      {
        id: "00000000-0000-4000-8000-000000000001",
        kind: "bookmark",
        color: null,
        comment: "Come back here",
        updatedAt: "2026-10-28T10:00:00Z",
        segments: [{ page: 1, rects: [] }],
      },
    ]);
    const text = await textReader(exported);
    const items = await importFromPdf(exported, text.pageText, measure);
    await text.destroy();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "bookmark", page: 1, comment: "Come back here" });
  });
});
