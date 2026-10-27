// @ts-check
/**
 * Synthesizes the edge-case PDFs of the golden corpus with pdf-lib, deterministically: the same
 * pdf-lib version always produces byte-identical files, so their sha256 lives in manifest.json.
 *
 *   node fixtures/pdfs/generate.mjs              rebuild every generated fixture and rewrite the
 *                                                manifest's generated entries (needs ~150 MB RAM)
 *   node fixtures/pdfs/generate.mjs --skip-large leave the two size-cap files and their entries alone
 *
 * Small files (< 200 KB) go to generated/ and are committed. Large ones go to generated-large/,
 * which is git-ignored; `pnpm fixtures` (fetch.mjs) rebuilds them on demand.
 *
 * Every coordinate this file records follows the annotation contract (docs/ARCHITECTURE.md §4):
 * PDF points relative to the page CropBox, unrotated, origin top-left, 0-based page index.
 */
import { execFileSync } from "node:child_process";
import { createCipheriv, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  concatTransformationMatrix,
  degrees,
  drawObject,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
} from "pdf-lib";

/**
 * @typedef {import("pdf-lib").PDFPage} PDFPage
 * @typedef {import("pdf-lib").PDFFont} PDFFont
 * @typedef {[number, number, number, number]} Rect
 * @typedef {{
 *   text: string; pageIndex: number; rect: Rect; tolerance: number; inTextLayer: boolean;
 *   font?: string; fontSize?: number; baseline?: [number, number]; charWidth?: number; note?: string;
 * }} KnownText
 * @typedef {{ pageCount: number; hasOutline: boolean; hasTextLayer: boolean; knownText: KnownText[]; [fact: string]: unknown }} Expected
 * @typedef {{ bytes: Uint8Array; expected: Expected }} Built
 * @typedef {{
 *   id: string; file: string; title: string; cases: string[]; tests: string; large: boolean;
 *   notes?: string; build: () => Promise<Built>;
 * }} GeneratedSpec
 */

export const PDFS_DIR = dirname(fileURLToPath(import.meta.url));
export const MANIFEST_PATH = join(PDFS_DIR, "manifest.json");

/** Fixed metadata so output is byte-stable. */
const FIXED_DATE = new Date("2026-01-01T00:00:00Z");
const PRODUCER = "Margin fixtures/pdfs/generate.mjs (pdf-lib 1.17.1)";

const GENERATED_LICENSE = {
  id: "CC0-1.0",
  url: "https://creativecommons.org/publicdomain/zero/1.0/",
  attribution: "Synthesized by fixtures/pdfs/generate.mjs in this repository; no third-party content.",
};

/** Ascender / descender per 1000 em, from Adobe's Core 14 AFM files. */
const METRICS = /** @type {const} */ ({
  Helvetica: { ascent: 718, descent: -207 },
  "Helvetica-Bold": { ascent: 718, descent: -207 },
  "Times-Roman": { ascent: 683, descent: -217 },
  Courier: { ascent: 629, descent: -157 },
});

/** Text boxes in generated files are exact (computed from AFM metrics), so the tolerance only absorbs engine rounding. */
const EXACT_TOLERANCE = 1;

const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.45, 0.45, 0.45);

/** @param {number} n */
const r3 = (n) => Math.round(n * 1000) / 1000;

/** @param {string} title */
async function newDoc(title) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(title);
  doc.setAuthor("Margin");
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  doc.setLanguage("en");
  return doc;
}

/** @param {PDFDocument} doc */
const save = (doc) => doc.save({ useObjectStreams: false });

/**
 * Advance width exactly as drawText renders it. pdf-lib's widthOfTextAtSize adds AFM kerning
 * pairs, but drawText emits a plain Tj without kerning, so measure one character at a time.
 * @param {PDFFont} font @param {string} text @param {number} size
 */
function advanceWidth(font, text, size) {
  let width = 0;
  for (const ch of text) width += font.widthOfTextAtSize(ch, size);
  return width;
}

/** Converts a top-left CropBox point into user space. @param {PDFPage} page @param {number} x @param {number} y */
function toUser(page, x, y) {
  const c = page.getCropBox();
  return { x: c.x + x, y: c.y + c.height - y };
}

/**
 * Draws text with its baseline-left at (x, y) in top-left CropBox coordinates and returns the
 * documented fact. The rect spans the font's ascender to descender (AFM metrics) over the advance width.
 * @param {PDFPage} page @param {number} pageIndex @param {PDFFont} font @param {keyof typeof METRICS} fontName
 * @param {string} text @param {number} x @param {number} y @param {number} size
 * @returns {KnownText}
 */
function placeText(page, pageIndex, font, fontName, text, x, y, size) {
  const user = toUser(page, x, y);
  page.drawText(text, { x: user.x, y: user.y, size, font, color: BLACK });
  const m = METRICS[fontName];
  const width = advanceWidth(font, text, size);
  return {
    text,
    pageIndex,
    rect: [r3(x), r3(y - (m.ascent / 1000) * size), r3(x + width), r3(y - (m.descent / 1000) * size)],
    tolerance: EXACT_TOLERANCE,
    inTextLayer: true,
    font: fontName,
    fontSize: size,
    baseline: [r3(x), r3(y)],
  };
}

/** Decorative text that is not part of the documented facts. @param {PDFPage} page @param {PDFFont} font @param {string} text @param {number} x @param {number} y @param {number} size */
function label(page, font, text, x, y, size) {
  const user = toUser(page, x, y);
  page.drawText(text, { x: user.x, y: user.y, size, font, color: GRAY });
}

/** Grid every 36 pt (major every 72 pt) with coordinate labels along the top and left edges. @param {PDFPage} page @param {PDFFont} font */
function drawGrid(page, font) {
  const c = page.getCropBox();
  for (let k = 36; k < c.width; k += 36) {
    const major = k % 72 === 0;
    page.drawLine({
      start: toUser(page, k, 0),
      end: toUser(page, k, c.height),
      thickness: major ? 0.5 : 0.25,
      color: major ? rgb(0.6, 0.75, 1) : rgb(0.85, 0.9, 1),
    });
    if (major) label(page, font, String(k), k + 1.5, 8, 5);
  }
  for (let k = 36; k < c.height; k += 36) {
    const major = k % 72 === 0;
    page.drawLine({
      start: toUser(page, 0, k),
      end: toUser(page, c.width, k),
      thickness: major ? 0.5 : 0.25,
      color: major ? rgb(0.6, 0.75, 1) : rgb(0.85, 0.9, 1),
    });
    if (major) label(page, font, String(k), 1.5, k - 1.5, 5);
  }
}

/** Red crosshair centered on a top-left point. @param {PDFPage} page @param {number} x @param {number} y */
function drawMarker(page, x, y) {
  const color = rgb(0.85, 0, 0);
  page.drawLine({ start: toUser(page, x - 8, y), end: toUser(page, x + 8, y), thickness: 0.5, color });
  page.drawLine({ start: toUser(page, x, y - 8), end: toUser(page, x, y + 8), thickness: 0.5, color });
  const center = toUser(page, x, y);
  page.drawCircle({ x: center.x, y: center.y, size: 3, borderColor: color, borderWidth: 0.5 });
}

/** Filled box given as a top-left rect. @param {PDFPage} page @param {Rect} rect */
function drawArea(page, [x0, y0, x1, y1]) {
  const user = toUser(page, x0, y1);
  page.drawRectangle({
    x: user.x,
    y: user.y,
    width: x1 - x0,
    height: y1 - y0,
    color: rgb(0.93, 0.93, 0.93),
    borderColor: rgb(0.4, 0.4, 0.4),
    borderWidth: 0.5,
  });
}

// ---------------------------------------------------------------------------------------------
// ruler.pdf: the pixel-accuracy reference
// ---------------------------------------------------------------------------------------------

async function buildRuler() {
  const doc = await newDoc("Margin ruler fixture");
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const courier = await doc.embedFont(StandardFonts.Courier);
  /** @type {KnownText[]} */
  const knownText = [];
  const rulerPages = [];

  // Page 0: US Letter.
  {
    const page = doc.addPage([612, 792]);
    drawGrid(page, helv);
    knownText.push(
      placeText(page, 0, bold, "Helvetica-Bold", "Margin ruler fixture, page 1: US Letter", 72, 60, 14),
    );
    /** @type {[number, number][]} */
    const samples = [
      [8, 96],
      [10, 114],
      [12, 136],
      [18, 166],
      [24, 204],
      [36, 254],
    ];
    for (const [size, y] of samples) {
      knownText.push(placeText(page, 0, helv, "Helvetica", `Sample ${size} pt`, 72, y, size));
    }
    const paragraph = [
      "Line one of the ruler paragraph begins exactly at x = 72 pt.",
      "Every line in this block uses 11 pt Helvetica with 15 pt leading.",
      "Highlights that span several lines must stay aligned at any zoom.",
      "Selection rectangles are compared against these documented boxes.",
      "The baseline of each line is listed in the manifest in points.",
      "This is the last line of the paragraph on the first ruler page.",
    ];
    paragraph.forEach((line, i) => {
      knownText.push(placeText(page, 0, helv, "Helvetica", line, 72, 320 + i * 15, 11));
    });
    /** @type {Rect} */
    const area = [324, 456, 540, 600];
    drawArea(page, area);
    knownText.push(placeText(page, 0, helv, "Helvetica", "Area target 216 x 144 pt", 332, 476, 9));
    knownText.push(
      placeText(page, 0, helv, "Helvetica", "Bottom margin sample near the page edge.", 72, 740, 10),
    );
    /** @type {[number, number][]} */
    const markers = [
      [72, 72],
      [540, 72],
      [72, 720],
      [540, 720],
    ];
    for (const [x, y] of markers) drawMarker(page, x, y);
    rulerPages.push({
      pageIndex: 0,
      size: [612, 792],
      grid: { minor: 36, major: 72 },
      markers,
      areas: [{ label: "Area target 216 x 144 pt", rect: area }],
    });
  }

  // Page 1: A4, fractional origins, three more fonts.
  {
    const width = 595.276;
    const height = 841.89;
    const page = doc.addPage([width, height]);
    drawGrid(page, helv);
    knownText.push(
      placeText(page, 1, bold, "Helvetica-Bold", "Margin ruler fixture, page 2: A4", 72, 60, 14),
    );
    const mono = placeText(page, 1, courier, "Courier", "MONOSPACE 0123456789 abcdefghij", 100.5, 120.25, 12);
    knownText.push({
      ...mono,
      charWidth: 7.2,
      note: "Courier: every glyph advances exactly 0.6 em, so character i spans x0 + 7.2 * i to x0 + 7.2 * (i + 1).",
    });
    knownText.push(
      placeText(page, 1, times, "Times-Roman", "Times Roman at a fractional origin", 72.25, 160.75, 16),
    );
    knownText.push(
      placeText(page, 1, helv, "Helvetica", "Tiny 4 pt text for high zoom checks", 72, 190, 4),
    );
    const rightText = "Right aligned to x 523.276";
    const rightX = width - 72 - advanceWidth(helv, rightText, 12);
    knownText.push(placeText(page, 1, helv, "Helvetica", rightText, r3(rightX), 230, 12));
    knownText.push(placeText(page, 1, helv, "Helvetica", "Big 48", 72, 320, 48));
    /** @type {Rect} */
    const area = [72, 400, 300, 520];
    drawArea(page, area);
    /** @type {[number, number][]} */
    const markers = [
      [72, 72],
      [523.276, 72],
      [72, 769.89],
      [523.276, 769.89],
    ];
    for (const [x, y] of markers) drawMarker(page, x, y);
    rulerPages.push({
      pageIndex: 1,
      size: [width, height],
      grid: { minor: 36, major: 72 },
      markers,
      areas: [{ label: "A4 area target 228 x 120 pt", rect: area }],
    });
  }

  return {
    bytes: await save(doc),
    expected: {
      pageCount: 2,
      hasOutline: false,
      hasTextLayer: true,
      knownText,
      ruler: {
        rectConvention:
          "knownText rects are [x0, top, x1, bottom]: advance width by AFM ascender to descender. baseline is [x, y] of the glyph origin.",
        pages: rulerPages,
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// mixed-pages.pdf: page sizes, /Rotate and a CropBox offset
// ---------------------------------------------------------------------------------------------

async function buildMixedPages() {
  const doc = await newDoc("Margin mixed page sizes and rotations fixture");
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  /** @type {{ label: string; size: [number, number]; rotate: 0 | 90 | 180 | 270; crop?: [number, number, number, number] }[]} */
  const specs = [
    { label: "US Letter portrait, Rotate 0", size: [612, 792], rotate: 0 },
    { label: "A4, Rotate 90", size: [595.276, 841.89], rotate: 90 },
    { label: "A5, Rotate 180", size: [419.528, 595.276], rotate: 180 },
    { label: "US Legal, Rotate 270", size: [612, 1008], rotate: 270 },
    { label: "Landscape MediaBox 792 x 612, Rotate 0", size: [792, 612], rotate: 0 },
    { label: "US Letter with CropBox offset (36, 54)", size: [612, 792], rotate: 0, crop: [36, 54, 540, 684] },
  ];
  /** @type {KnownText[]} */
  const knownText = [];
  const pages = [];
  for (const [i, spec] of specs.entries()) {
    const page = doc.addPage(spec.size);
    if (spec.rotate) page.setRotation(degrees(spec.rotate));
    if (spec.crop) {
      page.setCropBox(...spec.crop);
      // Drawn in the MediaBox but outside the CropBox: a viewer must not show it.
      page.drawText("OUTSIDE THE CROPBOX", { x: 4, y: 20, size: 10, font: helv, color: BLACK });
    }
    const c = page.getCropBox();
    // An upward triangle at the top center of the unrotated page shows its orientation.
    const origin = toUser(page, 0, 0);
    page.drawSvgPath(`M ${c.width / 2 - 12} 34 L ${c.width / 2 + 12} 34 L ${c.width / 2} 12 Z`, {
      x: origin.x,
      y: origin.y,
      color: rgb(0.2, 0.4, 0.9),
    });
    knownText.push(placeText(page, i, helv, "Helvetica", `Page ${i + 1} of 6: ${spec.label}`, 48, 72, 14));
    knownText.push(
      placeText(page, i, helv, "Helvetica", "Text is drawn in unrotated page space.", 48, 100, 11),
    );
    /** @type {Rect} */
    const area = [48, 120, 148, 180];
    drawArea(page, area);
    const quarter = spec.rotate === 90 || spec.rotate === 270;
    pages.push({
      pageIndex: i,
      mediaBox: [0, 0, spec.size[0], spec.size[1]],
      cropBox: [r3(c.x), r3(c.y), r3(c.x + c.width), r3(c.y + c.height)],
      rotate: spec.rotate,
      displaySize: quarter ? [r3(c.height), r3(c.width)] : [r3(c.width), r3(c.height)],
      areas: [{ label: "Grey box", rect: area }],
      ...(spec.crop ? { hiddenText: "OUTSIDE THE CROPBOX" } : {}),
    });
  }
  return {
    bytes: await save(doc),
    expected: { pageCount: specs.length, hasOutline: false, hasTextLayer: true, knownText, pages },
  };
}

// ---------------------------------------------------------------------------------------------
// annotations.pdf: existing /Highlight and /Text annotations to import
// ---------------------------------------------------------------------------------------------

/**
 * Highlight annotation with QuadPoints in Acrobat order (upper-left, upper-right, lower-left,
 * lower-right per quad) and a multiply-blended appearance stream.
 * @param {PDFDocument} doc @param {PDFPage} page @param {Rect[]} rects top-left rects
 * @param {[number, number, number]} color @param {string} contents @param {string} name
 */
function addHighlight(doc, page, rects, color, contents, name) {
  const c = page.getCropBox();
  const top = c.y + c.height;
  const quads = rects.flatMap(([x0, y0, x1, y1]) => {
    const ux0 = c.x + x0;
    const ux1 = c.x + x1;
    const uTop = top - y0;
    const uBottom = top - y1;
    return [ux0, uTop, ux1, uTop, ux0, uBottom, ux1, uBottom].map(r3);
  });
  const xs = quads.filter((_, k) => k % 2 === 0);
  const ys = quads.filter((_, k) => k % 2 === 1);
  const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const ops = rects
    .map(([x0, y0, x1, y1]) => {
      const ux = r3(c.x + x0);
      const uy = r3(top - y1);
      return `${ux} ${uy} ${r3(x1 - x0)} ${r3(y1 - y0)} re f`;
    })
    .join("\n");
  const appearance = doc.context.stream(`/GS0 gs ${color.join(" ")} rg\n${ops}\n`, {
    Type: "XObject",
    Subtype: "Form",
    BBox: bbox,
    Resources: { ExtGState: { GS0: { Type: "ExtGState", BM: "Multiply", ca: 1, CA: 1 } } },
  });
  const annot = doc.context.obj({
    Type: "Annot",
    Subtype: "Highlight",
    Rect: bbox,
    QuadPoints: quads,
    C: color,
    CA: 1,
    F: 4,
    Contents: PDFString.of(contents),
    T: PDFString.of("Fixture Author"),
    NM: PDFString.of(name),
    M: PDFString.of("D:20260101000000Z"),
    AP: { N: doc.context.register(appearance) },
  });
  page.node.addAnnot(doc.context.register(annot));
  return { quadPoints: quads, rect: bbox };
}

async function buildAnnotations() {
  const doc = await newDoc("Margin existing annotations fixture");
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const lines = [
    placeText(page, 0, helv, "Helvetica", "This sentence carries a yellow imported highlight.", 72, 120, 12),
    placeText(page, 0, helv, "Helvetica", "This green highlight starts on this line", 72, 160, 12),
    placeText(page, 0, helv, "Helvetica", "and continues onto the next line here.", 72, 175, 12),
    placeText(page, 0, helv, "Helvetica", "A sticky note is attached next to this sentence.", 72, 220, 12),
    placeText(page, 0, helv, "Helvetica", "This line has no annotation at all.", 72, 260, 12),
  ];
  const [l1, l2, l3, l4] = /** @type {[KnownText, KnownText, KnownText, KnownText]} */ (lines);

  /** @type {[number, number, number]} */
  const yellow = [1, 0.92, 0.23];
  /** @type {[number, number, number]} */
  const green = [0.3, 0.85, 0.4];
  const h1 = addHighlight(doc, page, [l1.rect], yellow, "Imported highlight: yellow, one line", "fixture-highlight-1");
  const h2 = addHighlight(
    doc,
    page,
    [l2.rect, l3.rect],
    green,
    "Imported highlight: green, two lines",
    "fixture-highlight-2",
  );

  /** @type {[number, number, number]} */
  const orange = [1, 0.6, 0];
  /** @type {Rect} */
  const noteTopLeft = [450, 204, 470, 224];
  const top = 792;
  const noteRect = [noteTopLeft[0], top - noteTopLeft[3], noteTopLeft[2], top - noteTopLeft[1]];
  const note = doc.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: noteRect,
    C: orange,
    F: 4,
    Name: "Comment",
    Open: false,
    Contents: PDFString.of("Imported sticky note"),
    T: PDFString.of("Fixture Author"),
    NM: PDFString.of("fixture-note-1"),
    M: PDFString.of("D:20260101000000Z"),
  });
  page.node.addAnnot(doc.context.register(note));

  const annotations = [
    {
      subtype: "Highlight",
      pageIndex: 0,
      name: "fixture-highlight-1",
      color: yellow,
      contents: "Imported highlight: yellow, one line",
      author: "Fixture Author",
      quote: l1.text,
      quadPoints: h1.quadPoints,
      rects: [l1.rect],
    },
    {
      subtype: "Highlight",
      pageIndex: 0,
      name: "fixture-highlight-2",
      color: green,
      contents: "Imported highlight: green, two lines",
      author: "Fixture Author",
      quote: `${l2.text} ${l3.text}`,
      quadPoints: h2.quadPoints,
      rects: [l2.rect, l3.rect],
    },
    {
      subtype: "Text",
      pageIndex: 0,
      name: "fixture-note-1",
      color: orange,
      contents: "Imported sticky note",
      author: "Fixture Author",
      pdfRect: noteRect,
      rects: [noteTopLeft],
      near: l4.text,
    },
  ];
  return {
    bytes: await save(doc),
    expected: {
      pageCount: 1,
      hasOutline: false,
      hasTextLayer: true,
      knownText: lines,
      annotations,
      annotationNotes:
        "quadPoints and pdfRect are raw PDF user space (origin bottom-left) exactly as stored in the file; rects are the same boxes in the contract's top-left CropBox space.",
    },
  };
}

// ---------------------------------------------------------------------------------------------
// javascript-forms.pdf: AcroForm fields plus JavaScript in every common location (security)
// ---------------------------------------------------------------------------------------------

const JS_MARKER = "MARGIN_FIXTURE_JS_EXECUTED";

/** @param {PDFDocument} doc @param {string} where */
const jsAction = (doc, where) =>
  doc.context.obj({ Type: "Action", S: "JavaScript", JS: PDFString.of(`app.alert("${JS_MARKER}: ${where}");`) });

async function buildJavaScriptForms() {
  const doc = await newDoc("Margin forms and JavaScript fixture");
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const knownText = [
    placeText(page, 0, helv, "Helvetica", "This file contains form fields and JavaScript.", 72, 72, 14),
    placeText(page, 0, helv, "Helvetica", "A safe viewer renders it but never runs the scripts.", 72, 92, 12),
    placeText(page, 0, helv, "Helvetica", "Full name", 72, 140, 11),
    placeText(page, 0, helv, "Helvetica", "Subscribe", 72, 190, 11),
    placeText(page, 0, helv, "Helvetica", "Country", 72, 240, 11),
    placeText(page, 0, helv, "Helvetica", "Click this line to run a JavaScript link action.", 72, 330, 11),
  ];
  const form = doc.getForm();
  /** @param {Rect} rect top-left */
  const widgetBox = ([x0, y0, x1, y1]) => ({ x: x0, y: 792 - y1, width: x1 - x0, height: y1 - y0 });

  /** @type {Rect} */
  const nameRect = [160, 124, 400, 146];
  const name = form.createTextField("full_name");
  name.setText("Ada Lovelace");
  name.addToPage(page, { ...widgetBox(nameRect), font: helv });
  name.acroField.dict.set(PDFName.of("AA"), doc.context.obj({ K: jsAction(doc, "field keystroke") }));

  /** @type {Rect} */
  const subscribeRect = [160, 176, 176, 192];
  const subscribe = form.createCheckBox("subscribe");
  subscribe.addToPage(page, widgetBox(subscribeRect));
  subscribe.check();

  /** @type {Rect} */
  const countryRect = [160, 226, 300, 246];
  const country = form.createDropdown("country");
  country.addOptions(["Canada", "France", "Morocco"]);
  country.select("Morocco");
  country.addToPage(page, { ...widgetBox(countryRect), font: helv });

  /** @type {Rect} */
  const buttonRect = [160, 270, 300, 294];
  const button = form.createButton("run_script");
  button.addToPage("Run script", page, { ...widgetBox(buttonRect), font: helv });
  for (const widget of button.acroField.getWidgets()) widget.dict.set(PDFName.of("A"), jsAction(doc, "button"));

  const linkLine = /** @type {KnownText} */ (knownText[5]);
  const [lx0, ly0, lx1, ly1] = linkLine.rect;
  const link = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [lx0, 792 - ly1, lx1, 792 - ly0],
    Border: [0, 0, 0],
    A: jsAction(doc, "link"),
  });
  page.node.addAnnot(doc.context.register(link));

  page.node.set(PDFName.of("AA"), doc.context.obj({ O: jsAction(doc, "page open") }));
  doc.catalog.set(PDFName.of("OpenAction"), jsAction(doc, "open action"));
  doc.addJavaScript("margin-fixture", `app.alert("${JS_MARKER}: document level");`);

  return {
    bytes: await save(doc),
    expected: {
      pageCount: 1,
      hasOutline: false,
      hasTextLayer: true,
      knownText,
      formFields: [
        { name: "full_name", type: "text", value: "Ada Lovelace", rect: nameRect },
        { name: "subscribe", type: "checkbox", value: true, rect: subscribeRect },
        { name: "country", type: "dropdown", value: "Morocco", options: ["Canada", "France", "Morocco"], rect: countryRect },
        { name: "run_script", type: "button", rect: buttonRect },
      ],
      javascript: {
        marker: JS_MARKER,
        locations: ["document level (Names /JavaScript)", "open action", "page open", "field keystroke", "button", "link"],
        note: `Every script calls app.alert("${JS_MARKER}: <location>"). If that marker ever shows up, a script ran.`,
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// encrypted.pdf: AES-256 (V5 / R6), written by hand because pdf-lib cannot encrypt
// ---------------------------------------------------------------------------------------------

export const ENCRYPTED_USER_PASSWORD = "margin-fixture";
export const ENCRYPTED_OWNER_PASSWORD = "margin-fixture-owner";

/** Deterministic pseudo-random bytes (SHA-256 in counter mode). @param {string} seed @param {number} length */
function seededBytes(seed, length) {
  const out = Buffer.alloc(length);
  for (let block = 0, offset = 0; offset < length; block++) {
    const digest = createHash("sha256").update(`${seed}:${block}`).digest();
    offset += digest.copy(out, offset);
  }
  return out;
}

/** ISO 32000-2 Algorithm 2.B (the R6 password hash). @param {Buffer} password @param {Buffer} salt @param {Buffer} userKey */
function hashR6(password, salt, userKey) {
  let k = createHash("sha256").update(Buffer.concat([password, salt, userKey])).digest();
  /** @type {Buffer} */
  let e = Buffer.alloc(0);
  for (let round = 0; round < 64 || /** @type {number} */ (e.at(-1)) > round - 32; round++) {
    const block = Buffer.concat([password, k, userKey]);
    const k1 = Buffer.concat(Array.from({ length: 64 }, () => block));
    const cipher = createCipheriv("aes-128-cbc", k.subarray(0, 16), k.subarray(16, 32));
    cipher.setAutoPadding(false);
    e = Buffer.concat([cipher.update(k1), cipher.final()]);
    let sum = 0;
    for (let j = 0; j < 16; j++) sum += /** @type {number} */ (e[j]);
    k = createHash(/** @type {const} */ (["sha256", "sha384", "sha512"])[sum % 3] ?? "sha256")
      .update(e)
      .digest();
  }
  return k.subarray(0, 32);
}

/** @param {string} algorithm @param {Buffer} key @param {Buffer | null} iv @param {Buffer} data @param {boolean} padding */
function aes(algorithm, key, iv, data, padding) {
  const cipher = createCipheriv(algorithm, key, iv);
  cipher.setAutoPadding(padding);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/** @param {string} text */
const pdfLiteral = (text) => `(${text.replace(/[\\()]/g, (ch) => `\\${ch}`)})`;

async function buildEncrypted() {
  // Measure the text with pdf-lib's Helvetica metrics so the documented boxes are exact.
  const metricsDoc = await PDFDocument.create({ updateMetadata: false });
  const helv = await metricsDoc.embedFont(StandardFonts.Helvetica);
  const lines = [
    { text: "This PDF is encrypted with AES-256.", x: 72, y: 100, size: 18 },
    { text: "It opens only with the user password from the manifest.", x: 72, y: 130, size: 12 },
  ];
  /** @type {KnownText[]} */
  const knownText = lines.map(({ text, x, y, size }) => ({
    text,
    pageIndex: 0,
    rect: [x, r3(y - 0.718 * size), r3(x + advanceWidth(helv, text, size)), r3(y + 0.207 * size)],
    tolerance: EXACT_TOLERANCE,
    inTextLayer: true,
    font: "Helvetica",
    fontSize: size,
    baseline: [x, y],
  }));

  const random = seededBytes("margin-encrypted-fixture", 32 + 16 * 3 + 4 + 16 * 4);
  let cursor = 0;
  /** @param {number} n */
  const take = (n) => random.subarray(cursor, (cursor += n));
  const fileKey = take(32);
  const userPassword = Buffer.from(ENCRYPTED_USER_PASSWORD, "utf8");
  const ownerPassword = Buffer.from(ENCRYPTED_OWNER_PASSWORD, "utf8");
  const userValidationSalt = take(8);
  const userKeySalt = take(8);
  const ownerValidationSalt = take(8);
  const ownerKeySalt = take(8);
  const zeroIv = Buffer.alloc(16);

  const u = Buffer.concat([hashR6(userPassword, userValidationSalt, Buffer.alloc(0)), userValidationSalt, userKeySalt]);
  const ue = aes("aes-256-cbc", hashR6(userPassword, userKeySalt, Buffer.alloc(0)), zeroIv, fileKey, false);
  const o = Buffer.concat([hashR6(ownerPassword, ownerValidationSalt, u), ownerValidationSalt, ownerKeySalt]);
  const oe = aes("aes-256-cbc", hashR6(ownerPassword, ownerKeySalt, u), zeroIv, fileKey, false);
  const permissions = -4; // everything allowed; bits 1-2 must be 0
  const permsPlain = Buffer.alloc(16);
  permsPlain.writeInt32LE(permissions, 0);
  permsPlain.fill(0xff, 4, 8);
  permsPlain.write("Tadb", 8, "latin1");
  take(4).copy(permsPlain, 12);
  const perms = aes("aes-256-ecb", fileKey, null, permsPlain, false);

  /** AESV3: AES-256-CBC with the file key, a 16-byte IV prefix and PKCS#7 padding. @param {Buffer} data */
  const encrypt = (data) => {
    const iv = take(16);
    return Buffer.concat([iv, aes("aes-256-cbc", fileKey, iv, data, true)]);
  };
  const hex = (/** @type {Buffer} */ b) => `<${b.toString("hex").toUpperCase()}>`;

  const content = lines
    .map(({ text, x, y, size }) => `BT /F1 ${size} Tf ${x} ${r3(792 - y)} Td ${pdfLiteral(text)} Tj ET`)
    .join("\n");
  const encryptedContent = encrypt(Buffer.from(content, "latin1"));

  /** @type {(string | Buffer)[]} */
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R /Extensions << /ADBE << /BaseVersion /1.7 /ExtensionLevel 8 >> >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    Buffer.concat([
      Buffer.from(`<< /Length ${encryptedContent.length} >>\nstream\n`, "latin1"),
      encryptedContent,
      Buffer.from("\nendstream", "latin1"),
    ]),
    `<< /Title ${hex(encrypt(Buffer.from("Margin encrypted fixture", "latin1")))} /Producer ${hex(encrypt(Buffer.from(PRODUCER, "latin1")))} >>`,
    [
      "<< /Filter /Standard /V 5 /R 6 /Length 256",
      "/CF << /StdCF << /Type /CryptFilter /CFM /AESV3 /AuthEvent /DocOpen /Length 32 >> >>",
      "/StmF /StdCF /StrF /StdCF",
      `/O ${hex(o)} /U ${hex(u)} /OE ${hex(oe)} /UE ${hex(ue)}`,
      `/P ${permissions} /Perms ${hex(perms)} /EncryptMetadata true >>`,
    ].join("\n"),
  ];

  /** @type {Buffer[]} */
  const chunks = [Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  let length = /** @type {Buffer} */ (chunks[0]).length;
  /** @type {number[]} */
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, "latin1"),
      typeof body === "string" ? Buffer.from(body, "latin1") : body,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    chunks.push(chunk);
    length += chunk.length;
  });
  const id = hex(seededBytes("margin-encrypted-fixture-id", 16));
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f\r",
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n\r`),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R /Encrypt 7 0 R /ID [${id} ${id}] >>`,
    "startxref",
    String(length),
    "%%EOF",
    "",
  ].join("\n");
  chunks.push(Buffer.from(xref, "latin1"));

  return {
    bytes: new Uint8Array(Buffer.concat(chunks)),
    expected: {
      pageCount: 1,
      hasOutline: false,
      hasTextLayer: true,
      knownText,
      encryption: {
        algorithm: "AES-256 (Standard security handler V5 / R6)",
        userPassword: ENCRYPTED_USER_PASSWORD,
        ownerPassword: ENCRYPTED_OWNER_PASSWORD,
        note: "Opening without a password must prompt; a wrong password must be rejected. Text facts apply after decryption.",
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// corrupted-truncated.pdf
// ---------------------------------------------------------------------------------------------

const TRUNCATE_RATIO = 0.6;

async function buildCorrupted() {
  const doc = await newDoc("Margin corrupted fixture");
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  /** @type {KnownText[]} */
  const knownText = [];
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([612, 792]);
    knownText.push(
      placeText(page, i, helv, "Helvetica", `Page ${i + 1} of a file that was cut off mid-download.`, 72, 100, 14),
    );
  }
  const full = await save(doc);
  const keptBytes = Math.floor(full.length * TRUNCATE_RATIO);
  return {
    bytes: full.slice(0, keptBytes),
    expected: {
      pageCount: 3,
      hasOutline: false,
      hasTextLayer: true,
      knownText: knownText.slice(0, 1),
      corruption: {
        kind: "truncated",
        keptBytes,
        originalBytes: full.length,
        originalSha256: createHash("sha256").update(full).digest("hex"),
        note: "The last 40% (including the xref table and trailer) is missing. pageCount and knownText describe the intact original. A reader must fail gracefully: a clear error or a partial render, never a crash or a hang.",
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// size-under-cap.pdf / size-over-cap.pdf: around the 50 MB upload limit
// ---------------------------------------------------------------------------------------------

/** Decimal and binary readings of "50 MB"; the two size fixtures sit clear of both. */
export const STORAGE_CAP_BYTES = { decimal: 50_000_000, binary: 52_428_800 };

/**
 * Pages filled with incompressible, deterministic noise (raw 8-bit gray images, no filter),
 * so the file size is predictable and the bytes stay stable.
 * @param {string} title @param {string} sentence @param {number} targetBytes
 */
async function buildSized(title, sentence, targetBytes) {
  const doc = await newDoc(title);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const pageCount = 10;
  const width = 2048;
  const height = Math.floor(targetBytes / pageCount / width);
  /** @type {KnownText[]} */
  const knownText = [];
  let state = 0x9e3779b9;
  for (let i = 0; i < pageCount; i++) {
    const pixels = new Uint8Array(width * height);
    for (let p = 0; p < pixels.length; p += 4) {
      // xorshift32
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      pixels[p] = state & 0xff;
      pixels[p + 1] = (state >>> 8) & 0xff;
      pixels[p + 2] = (state >>> 16) & 0xff;
      pixels[p + 3] = (state >>> 24) & 0xff;
    }
    const image = doc.context.stream(pixels, {
      Type: "XObject",
      Subtype: "Image",
      Width: width,
      Height: height,
      ColorSpace: "DeviceGray",
      BitsPerComponent: 8,
    });
    const page = doc.addPage([612, 792]);
    const name = page.node.newXObject("Noise", doc.context.register(image));
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(468, 0, 0, 576, 72, 72),
      drawObject(name),
      popGraphicsState(),
    );
    page.drawRectangle({ x: 60, y: 690, width: 492, height: 40, color: rgb(1, 1, 1) });
    knownText.push(placeText(page, i, helv, "Helvetica", `${sentence} Page ${i + 1} of ${pageCount}.`, 72, 82, 12));
  }
  return {
    bytes: await save(doc),
    expected: {
      pageCount,
      hasOutline: false,
      hasTextLayer: true,
      knownText: knownText.slice(0, 2),
      storageCap: STORAGE_CAP_BYTES,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

/** @type {GeneratedSpec[]} */
export const GENERATED = [
  {
    id: "ruler",
    file: "generated/ruler.pdf",
    title: "Ruler: text, markers and areas at documented coordinates",
    cases: ["ruler"],
    tests:
      "Pixel accuracy of rendering, text selection and annotation overlays at every zoom: every text run, crosshair and box has exact documented coordinates.",
    large: false,
    build: buildRuler,
  },
  {
    id: "mixed-pages",
    file: "generated/mixed-pages.pdf",
    title: "Mixed page sizes, /Rotate 90/180/270 and a CropBox offset",
    cases: ["mixed-page-sizes", "rotated-pages", "cropbox-offset"],
    tests:
      "Coordinate transforms: rects stay correct on rotated pages, different page sizes in one document and a page whose CropBox does not start at (0, 0).",
    large: false,
    build: buildMixedPages,
  },
  {
    id: "annotations",
    file: "generated/annotations.pdf",
    title: "Existing /Highlight and /Text annotations",
    cases: ["existing-annotations"],
    tests:
      "Import of highlights and sticky notes made in other apps: known QuadPoints, colors, authors and contents.",
    large: false,
    build: buildAnnotations,
  },
  {
    id: "javascript-forms",
    file: "generated/javascript-forms.pdf",
    title: "AcroForm fields plus JavaScript actions",
    cases: ["javascript", "forms"],
    tests:
      "Security: the viewer renders form fields but never executes document, open, page, field, button or link JavaScript.",
    large: false,
    build: buildJavaScriptForms,
  },
  {
    id: "encrypted",
    file: "generated/encrypted.pdf",
    title: "Password-protected PDF (AES-256)",
    cases: ["password-protected"],
    tests: "Password prompt, wrong-password rejection and normal reading after unlocking.",
    large: false,
    notes:
      "Generated because no clearly licensed real-world encrypted PDF with a published password was found. pdf-lib cannot encrypt, so generate.mjs writes this file directly (ISO 32000-2 Algorithms 2.B, 8, 9 and 10).",
    build: buildEncrypted,
  },
  {
    id: "corrupted",
    file: "generated/corrupted-truncated.pdf",
    title: "Corrupted PDF: truncated mid-file",
    cases: ["corrupted"],
    tests: "Graceful failure on a damaged upload: clear error or partial render, never a crash or hang.",
    large: false,
    build: buildCorrupted,
  },
  {
    id: "size-under-cap",
    file: "generated-large/size-under-cap.pdf",
    title: "47 MB PDF, just under the 50 MB storage cap",
    cases: ["size-under-cap"],
    tests: "Upload limit: accepted under both the decimal (50,000,000 B) and binary (52,428,800 B) reading of 50 MB.",
    large: true,
    notes: "Generated rather than downloaded so the size is exact and stable. Ten pages of incompressible noise.",
    build: () => buildSized("Margin size fixture: under the cap", "Margin size fixture just under the 50 MB cap.", 47_000_000),
  },
  {
    id: "size-over-cap",
    file: "generated-large/size-over-cap.pdf",
    title: "54 MB PDF, just over the 50 MB storage cap",
    cases: ["size-over-cap"],
    tests: "Upload limit: rejected before upload under both readings of 50 MB.",
    large: true,
    notes: "Generated rather than downloaded so the size is exact and stable. Ten pages of incompressible noise.",
    build: () => buildSized("Margin size fixture: over the cap", "Margin size fixture just over the 50 MB cap.", 54_000_000),
  },
];

/** @param {Uint8Array} bytes */
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Builds one generated fixture in memory and returns its manifest entry alongside the bytes.
 * @param {GeneratedSpec} spec
 */
export async function buildGenerated(spec) {
  const { bytes, expected } = await spec.build();
  const entry = {
    id: spec.id,
    file: spec.file,
    title: spec.title,
    cases: spec.cases,
    tests: spec.tests,
    source: { kind: "generated", generator: "fixtures/pdfs/generate.mjs" },
    license: GENERATED_LICENSE,
    sha256: sha256(bytes),
    bytes: bytes.length,
    committed: !spec.large,
    expected,
    ...(spec.notes ? { notes: spec.notes } : {}),
  };
  return { bytes, entry };
}

/** @param {string} id */
export function generatedSpec(id) {
  const spec = GENERATED.find((s) => s.id === id);
  if (!spec) throw new Error(`No generated fixture with id "${id}"`);
  return spec;
}

/** Formats a JSON file with the repo's Biome config so `pnpm lint` stays green. @param {string} path */
function formatWithBiome(path) {
  const require = createRequire(import.meta.url);
  const biome = require.resolve("@biomejs/biome/bin/biome");
  execFileSync(process.execPath, [biome, "format", "--write", path], { stdio: "inherit" });
}

async function main() {
  const skipLarge = process.argv.includes("--skip-large");
  /** @type {{ entries: { id: string; source: { kind: string } }[] } & Record<string, unknown>} */
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const previous = new Map(manifest.entries.map((e) => [e.id, e]));
  const generatedEntries = [];
  for (const spec of GENERATED) {
    if (spec.large && skipLarge) {
      const kept = previous.get(spec.id);
      if (kept) generatedEntries.push(kept);
      console.log(`skip  ${spec.id} (--skip-large)`);
      continue;
    }
    const { bytes, entry } = await buildGenerated(spec);
    if (!spec.large && bytes.length >= 200 * 1024) {
      throw new Error(`${spec.file} is ${bytes.length} bytes; committed fixtures must stay under 200 KB`);
    }
    const target = join(PDFS_DIR, spec.file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    generatedEntries.push(entry);
    console.log(`wrote ${spec.file} (${bytes.length} bytes, sha256 ${entry.sha256.slice(0, 12)}…)`);
  }
  manifest.entries = [...manifest.entries.filter((e) => e.source.kind !== "generated"), ...generatedEntries];
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  formatWithBiome(MANIFEST_PATH);
  console.log(`updated ${MANIFEST_PATH}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
