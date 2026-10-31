import type { HighlightColor, Rect } from "@margin/annotation-model";
import { type PDFArray, PDFDict, PDFDocument, PDFName, type PDFPage, PDFString } from "pdf-lib";
import { contentsWithTags } from "../annotations/tags";
import { colorToRgb } from "./colors";
import {
  boundsOf,
  type PageBox,
  rectsToQuadPoints,
  rectToPdfRect,
  round3,
  visibleBox,
} from "./geometry";

/** What the exporter needs from an annotation (a subset of the app's `Annotation`). */
export interface ExportableAnnotation {
  id: string;
  kind: "highlight" | "area" | "bookmark";
  color: HighlightColor | null;
  comment: string | null;
  /** Written as `#tag` words at the end of `/Contents`. */
  tags?: readonly string[];
  updatedAt: string;
  segments: { page: number; rects: Rect[] }[];
}

/** PDF date string, `D:YYYYMMDDHHmmSSZ`, in UTC. */
export function pdfDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

const BOOKMARK_SIZE = 20;

/** `/Contents` for a highlight or area: the comment plus the tags as `#tag` words. */
function contentsEntry(a: ExportableAnnotation) {
  const contents = contentsWithTags(a.comment, a.tags ?? []);
  return contents ? { Contents: PDFString.of(contents) } : {};
}

function addHighlight(
  doc: PDFDocument,
  page: PDFPage,
  box: PageBox,
  a: ExportableAnnotation,
  rects: Rect[],
  author: string,
) {
  const color = colorToRgb(a.color ?? "key");
  const quads = rectsToQuadPoints(rects, box);
  const bbox = boundsOf(rects);
  const pdfBox = rectToPdfRect(bbox, box);
  // Appearance stream: the same boxes filled with Multiply blending, so the text stays readable
  // in viewers that draw the stream instead of building their own (Acrobat, Preview).
  const ops = rects
    .map((r) => {
      const [llx, lly] = rectToPdfRect(r, box);
      return `${llx} ${lly} ${round3(r[2] - r[0])} ${round3(r[3] - r[1])} re f`;
    })
    .join("\n");
  const appearance = doc.context.stream(`/GS0 gs ${color.map(round3).join(" ")} rg\n${ops}\n`, {
    Type: "XObject",
    Subtype: "Form",
    BBox: pdfBox,
    Resources: { ExtGState: { GS0: { Type: "ExtGState", BM: "Multiply", ca: 1, CA: 1 } } },
  });
  const annot = doc.context.obj({
    Type: "Annot",
    Subtype: "Highlight",
    Rect: pdfBox,
    QuadPoints: quads,
    C: color.map(round3),
    CA: 1,
    F: 4,
    ...contentsEntry(a),
    T: PDFString.of(author),
    NM: PDFString.of(a.id),
    M: PDFString.of(pdfDate(a.updatedAt)),
    AP: { N: doc.context.register(appearance) },
  });
  page.node.addAnnot(doc.context.register(annot));
}

function addSquare(
  doc: PDFDocument,
  page: PDFPage,
  box: PageBox,
  a: ExportableAnnotation,
  rect: Rect,
  author: string,
) {
  const annot = doc.context.obj({
    Type: "Annot",
    Subtype: "Square",
    Rect: rectToPdfRect(rect, box),
    C: colorToRgb(a.color ?? "key").map(round3),
    CA: 1,
    F: 4,
    BS: { W: 1.5 },
    ...contentsEntry(a),
    T: PDFString.of(author),
    NM: PDFString.of(a.id),
    M: PDFString.of(pdfDate(a.updatedAt)),
  });
  page.node.addAnnot(doc.context.register(annot));
}

/**
 * Bookmarks become `/Text` (sticky note) annotations, not outline entries: an outline entry needs a
 * place in the author's own table of contents (and would change it), while a sticky note shows in
 * Acrobat, Chrome, Preview and Zotero, carries the comment as `/Contents`, and is exactly what the
 * importer reads back as a bookmark. A bookmark without a spot goes in the top-right corner, where
 * the reader draws its ribbon.
 */
function addBookmark(
  doc: PDFDocument,
  page: PDFPage,
  box: PageBox,
  a: ExportableAnnotation,
  rect: Rect | undefined,
  author: string,
) {
  const width = box.x1 - box.x0;
  const spot: Rect = rect ?? [width - 36, 12, width - 36 + BOOKMARK_SIZE, 12 + BOOKMARK_SIZE];
  const annot = doc.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: rectToPdfRect(spot, box),
    Name: "Comment",
    Open: false,
    F: 4,
    C: [1, 0.8, 0],
    Contents: PDFString.of(a.comment ?? "Bookmark"),
    T: PDFString.of(author),
    NM: PDFString.of(a.id),
    M: PDFString.of(pdfDate(a.updatedAt)),
  });
  page.node.addAnnot(doc.context.register(annot));
}

/** Subtypes the importer turns into annotations (plus their popups). */
const IMPORTED_SUBTYPES = new Set([
  "Highlight",
  "Underline",
  "Squiggly",
  "StrikeOut",
  "Text",
  "Popup",
]);

/** Removes the annotations the importer reads, so re-exporting does not double them. */
function stripImportable(page: PDFPage) {
  const annots = page.node.Annots();
  if (!annots) return;
  const keep = page.doc.context.obj([]) as PDFArray;
  for (let i = 0; i < annots.size(); i++) {
    const dict = annots.lookupMaybe(i, PDFDict);
    const subtype = dict?.lookup(PDFName.of("Subtype"));
    if (subtype instanceof PDFName && IMPORTED_SUBTYPES.has(subtype.decodeText())) continue;
    keep.push(annots.get(i));
  }
  page.node.set(PDFName.of("Annots"), keep);
}

/**
 * A copy of the PDF with the annotations added as real PDF annotations. With `replaceExisting`
 * the file's own highlights and notes are dropped first: they were imported into the library, so
 * the library (which the user may have edited) is the source of truth.
 */
export async function exportAnnotatedPdf(
  bytes: ArrayBuffer | Uint8Array,
  annotations: readonly ExportableAnnotation[],
  author = "Margin",
  replaceExisting = false,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    throwOnInvalidObject: false,
    updateMetadata: false,
  });
  const pages = doc.getPages();
  if (replaceExisting) for (const page of pages) stripImportable(page);
  for (const a of annotations) {
    for (const [i, segment] of a.segments.entries()) {
      const page = pages[segment.page];
      if (!page) continue;
      const box = visibleBox(page.getMediaBox(), page.getCropBox());
      if (a.kind === "highlight" && segment.rects.length > 0) {
        addHighlight(doc, page, box, a, segment.rects, author);
      } else if (a.kind === "area" && segment.rects[0]) {
        addSquare(doc, page, box, a, segment.rects[0], author);
      } else if (a.kind === "bookmark" && i === 0) {
        addBookmark(doc, page, box, a, segment.rects[0], author);
      }
    }
  }
  return doc.save({ useObjectStreams: false });
}
