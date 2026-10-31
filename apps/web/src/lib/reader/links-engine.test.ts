// @vitest-environment node

import { pathToFileURL } from "node:url";
import { PDFArray, PDFDocument, PDFHexString, PDFName, type PDFPage, PDFString } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

// Node cannot run the browser build; the legacy build is the same API.
vi.mock("pdfjs-dist", async () => await import("pdfjs-dist/legacy/build/pdf.mjs"));

const legacyDir = `${pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href.replace(/pdf\.mjs$/, "")}`;

import { pdfJsEngine } from "@margin/reader";

/** Adds a /Link annotation with the given action or destination entries. */
function addLink(
  doc: PDFDocument,
  page: PDFPage,
  rect: [number, number, number, number],
  entries: Record<string, unknown>,
) {
  const dict = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: rect,
    Border: [0, 0, 0],
    ...entries,
  } as never);
  const ref = doc.context.register(dict);
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray) ?? doc.context.obj([]);
  annots.push(ref);
  page.node.set(PDFName.of("Annots"), annots);
}

async function linkedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([612, 792]);
  const p2 = doc.addPage([612, 792]);
  const p3 = doc.addPage([600, 400]);
  p1.drawText("page one");
  // Explicit destination: page 3, FitH at y = 300 of a 400 pt page => 100 pt from the top.
  addLink(doc, p1, [72, 700, 172, 712], {
    Dest: doc.context.obj([p3.ref, "FitH", 300]),
  });
  // Named destination (in /Names -> /Dests) pointing at page 2, XYZ top = 500 => 292 pt from the top.
  const names = doc.context.obj({
    Dests: { Names: [PDFHexString.fromText("sec.two"), [p2.ref, "XYZ", 0, 500, null]] },
  });
  doc.catalog.set(PDFName.of("Names"), names);
  addLink(doc, p1, [72, 650, 172, 662], { Dest: PDFString.of("sec.two") });
  // External https link, a javascript: URI, a JavaScript action, a file: URI.
  addLink(doc, p1, [72, 600, 172, 612], {
    A: { Type: "Action", S: "URI", URI: PDFString.of("https://example.org/paper") },
  });
  addLink(doc, p1, [72, 550, 172, 562], {
    A: { Type: "Action", S: "URI", URI: PDFString.of("javascript:alert(1)") },
  });
  addLink(doc, p1, [72, 500, 172, 512], {
    A: { Type: "Action", S: "JavaScript", JS: PDFString.of("app.alert('x')") },
  });
  addLink(doc, p1, [72, 450, 172, 462], {
    A: { Type: "Action", S: "URI", URI: PDFString.of("file:///etc/passwd") },
  });
  addLink(doc, p1, [72, 400, 172, 412], {
    A: { Type: "Action", S: "URI", URI: PDFString.of("mailto:a@example.org") },
  });
  return doc.save({ useObjectStreams: false });
}

describe("ReaderDocument.links", () => {
  it("resolves explicit and named destinations and keeps only safe external links", async () => {
    const bytes = await linkedPdf();
    const doc = await pdfJsEngine.open(bytes, { assetBaseUrl: legacyDir });
    try {
      const links = await doc.links(0);
      const internal = links.filter((l) => l.target.kind === "internal");
      const external = links.flatMap((l) => (l.target.kind === "external" ? [l.target.url] : []));
      expect(internal).toHaveLength(2);
      const toPage3 = internal.find(
        (l) => l.target.kind === "internal" && l.target.pageIndex === 2,
      );
      const toPage2 = internal.find(
        (l) => l.target.kind === "internal" && l.target.pageIndex === 1,
      );
      expect(toPage3?.target).toEqual({ kind: "internal", pageIndex: 2, offsetPt: 100 });
      expect(toPage2?.target).toEqual({ kind: "internal", pageIndex: 1, offsetPt: 292 });
      // Rect: top-left origin, in points: y 700..712 on a 792 pt page => 80..92.
      expect(toPage3?.rect.map(Math.round)).toEqual([72, 80, 172, 92]);
      expect(external).toEqual(["https://example.org/paper", "mailto:a@example.org"]);
      expect(await doc.links(1)).toEqual([]);
    } finally {
      await doc.destroy();
    }
  });
});
