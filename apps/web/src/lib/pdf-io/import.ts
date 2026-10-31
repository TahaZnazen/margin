import {
  type HighlightColor,
  mergeLineRects,
  type Quote,
  type Rect,
} from "@margin/annotation-model";
import type { Measure, PageText } from "@margin/reader";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
} from "pdf-lib";
import { splitContentsTags } from "../annotations/tags";
import { nearestColor, pdfColorToRgb } from "./colors";
import { type PageBox, pdfRectToRect, quadPointsToRects, visibleBox } from "./geometry";
import { quoteFromRects } from "./quote";

/** An annotation as written in the file: user-space numbers, nothing interpreted yet. */
export interface RawAnnotation {
  page: number;
  subtype: string;
  rect: number[];
  quadPoints: number[];
  color: number[];
  contents: string | null;
  author: string | null;
}

export interface RawAnnotations {
  boxes: PageBox[];
  annotations: RawAnnotation[];
}

const MARKUP = new Set(["Highlight", "Underline", "Squiggly", "StrikeOut"]);

function numbers(dict: PDFDict, key: string): number[] {
  const arr = dict.lookup(PDFName.of(key));
  if (!(arr instanceof PDFArray)) return [];
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const n = arr.lookup(i);
    if (n instanceof PDFNumber) out.push(n.asNumber());
  }
  return out;
}

function text(dict: PDFDict, key: string): string | null {
  const v = dict.lookup(PDFName.of(key));
  if (v instanceof PDFString || v instanceof PDFHexString) {
    const s = v.decodeText().replace(/\r\n?/g, "\n").trim();
    return s || null;
  }
  return null;
}

/** Reads the annotations of every page with pdf-lib (no rendering, works in node and browsers). */
export async function readRawAnnotations(bytes: ArrayBuffer | Uint8Array): Promise<RawAnnotations> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    throwOnInvalidObject: false,
    updateMetadata: false,
  });
  const boxes: PageBox[] = [];
  const annotations: RawAnnotation[] = [];
  doc.getPages().forEach((page, index) => {
    boxes.push(visibleBox(page.getMediaBox(), page.getCropBox()));
    const annots = page.node.Annots();
    if (!annots) return;
    for (let i = 0; i < annots.size(); i++) {
      const dict = annots.lookupMaybe(i, PDFDict);
      if (!dict) continue;
      const subtype = dict.lookup(PDFName.of("Subtype"));
      if (!(subtype instanceof PDFName)) continue;
      annotations.push({
        page: index,
        subtype: subtype.decodeText(),
        rect: numbers(dict, "Rect"),
        quadPoints: numbers(dict, "QuadPoints"),
        color: numbers(dict, "C"),
        contents: text(dict, "Contents"),
        author: text(dict, "T"),
      });
    }
  });
  return { boxes, annotations };
}

export interface ImportedHighlight {
  kind: "highlight";
  page: number;
  rects: Rect[];
  color: HighlightColor;
  comment: string | null;
  tags: string[];
  quote: Quote;
  /** True when no text was found under the rects and the quote is a placeholder. */
  noText: boolean;
}

export interface ImportedBookmark {
  kind: "bookmark";
  page: number;
  rects: Rect[];
  comment: string | null;
}

export type ImportedItem = ImportedHighlight | ImportedBookmark;

export const NO_TEXT_QUOTE = "(imported highlight, no text found under it)";

/**
 * Raw annotations to model items. Highlight, Underline, Squiggly and StrikeOut become highlights
 * (quote read from the text under the rects, nearest semantic color, `/Contents` as the comment);
 * Text notes become bookmarks. Square is skipped: the UI has no area kind yet.
 */
export async function convertAnnotations(
  raw: RawAnnotations,
  pageText: (page: number) => Promise<PageText>,
  measure: Measure,
): Promise<ImportedItem[]> {
  const out: ImportedItem[] = [];
  for (const a of raw.annotations) {
    const box = raw.boxes[a.page];
    if (!box) continue;
    if (MARKUP.has(a.subtype)) {
      let rects =
        a.quadPoints.length >= 8
          ? quadPointsToRects(a.quadPoints, box)
          : a.rect.length === 4
            ? [pdfRectToRect(a.rect, box)]
            : [];
      rects = rects.filter((r) => r[2] > r[0] && r[3] > r[1]);
      if (rects.length === 0) continue;
      const lines = rects.length > 1 ? mergeLineRects(rects) : rects;
      const found = quoteFromRects(
        await pageText(a.page).catch(() => ({ text: "", runs: [] })),
        lines,
        measure,
      );
      const { comment, tags } = splitContentsTags(a.contents);
      out.push({
        kind: "highlight",
        page: a.page,
        rects: lines,
        color: nearestColor(pdfColorToRgb(a.color)),
        comment,
        tags,
        quote: found?.quote ?? { exact: NO_TEXT_QUOTE, prefix: "", suffix: "" },
        noText: !found,
      });
    } else if (a.subtype === "Text" && a.rect.length === 4) {
      out.push({
        kind: "bookmark",
        page: a.page,
        rects: [pdfRectToRect(a.rect, box)],
        comment: a.contents,
      });
    }
  }
  return out;
}

export async function importFromPdf(
  bytes: ArrayBuffer | Uint8Array,
  pageText: (page: number) => Promise<PageText>,
  measure: Measure,
): Promise<ImportedItem[]> {
  return convertAnnotations(await readRawAnnotations(bytes), pageText, measure);
}
