# ADR 0003 — Reader engine: PDF.js behind `ReaderEngine`

Status: Accepted · 2026-10-27 · Replaces the P04 engine spike (decision made by the founder, not measured)

## Context

ARCHITECTURE §1 and §2 named EmbedPDF (MIT, PDFium compiled to WASM) as the first choice and PDF.js (Apache-2.0) as the fallback, with a WP-02 spike to decide. The founder chose PDF.js directly. Principle 3 still holds: annotations are ours (PDF points plus a text quote, ADR 0001) and every engine call goes through `ReaderEngine` in `packages/reader`, so the choice can be revisited without touching stored data.

## Decision

1. **Engine: `pdfjs-dist` 6.x (Apache-2.0).** Parsing, font handling and image decoding run in PDF.js's own Web Worker (`pdf.worker.min.mjs`, served from `/pdfjs/`). Page painting uses PDF.js's canvas renderer on the main thread, one page at a time, cancellable.
2. **EmbedPDF is rejected for maturity and debugging risk, not on measurements.** It is a young project that wraps PDFium WASM behind its own plugin system. When selection, search or rendering misbehave on a real book, we would debug a layer we do not know on top of a native engine. PDF.js is the most deployed browser PDF engine, has years of bug reports and answers, and its failure modes are documented. We did not benchmark EmbedPDF; if PDF.js misses a budget in ARCHITECTURE §7 on the corpus, the spike is reopened and the adapter is the only code that changes.
3. **Our own overlay layer, not the engine's annotation layer.** PDF.js's `AnnotationLayer` and editor layer are not used and not loaded. The page is rendered with annotations off (`AnnotationMode.DISABLE`) and the viewer stacks, inside each page box: the canvas, a find-highlight layer, an **overlay slot** for P09 (children receive the page → viewport transform from `@margin/annotation-model`), and our own **text layer**. Highlights therefore never depend on PDF.js's private structures.
4. **Our own text layer.** PDF.js's `TextLayer` positions spans in a way tied to its viewer's CSS (rotation and scale variables), and the geometry we need for selection (ascender-to-descender boxes, exact page coordinates) is not what its spans expose. The engine returns text runs (`TextRun`: string, baseline origin, advance width, font size, ascent and descent, angle, direction) already in our coordinate convention (page CropBox, unrotated, origin top-left). The viewer builds transparent, selectable spans in page points inside a container scaled and rotated by one CSS matrix that is the same transform as `pageToViewport`. Selection, find highlights and overlays all derive from the runs, so they cannot drift from each other.
5. **Selection → target.** `onSelection` reads the browser selection, maps it to run and character offsets, and builds a `highlight` target: whole runs use the run box (font ascent to descent), partial runs are cut proportionally to measured glyph widths (right-to-left runs mirrored), boxes are merged per line with `mergeLineRects`, the quote comes from `buildQuote`, and the result is validated by `HighlightTarget`. A selection across pages yields one segment per page. The fingerprint is SHA-256 of the file bytes.
6. **Scripts never run.** The core `getDocument` API has no scripting; PDF JavaScript lives in the separate viewer sandbox (`pdf.sandbox.mjs`), which we do not load. `pdfjs-dist` 6 also dropped string evaluation, so there is no `isEvalSupported` switch left to turn off. XFA is disabled. The JS fixture is an E2E test.
7. **Dark mode: dim, optionally invert, never recolor.** The page canvas gets `filter: var(--page-filter)` from the theme tokens: `brightness(0.8)` in dark. Sepia multiplies the white paper with the warm `--page-tint`. Trade-off: dimming keeps photographs, figures and colored charts exactly as the author drew them and keeps highlight colors honest, but the page is still a light rectangle on a dark UI, which is the brightest thing on screen at night. `invertInDark` switches to `invert(0.9) hue-rotate(180deg)`, which is comfortable for text-only books but inverts images (hue-rotate only partly restores them) and changes how highlights look. Default is dim; inversion is an opt-in prop and can become a user setting later. We do not recolor text through PDF.js `pageColors`, because it also recolors figures.
8. **Virtualization.** Only pages within the visible range ±2 are in the DOM; their size is known before they render (page 1's size is used until each page's own size arrives from the worker, in the background, with scroll position preserved by anchoring on page and offset). Pages that leave the window are unmounted and `PDFPageProxy.cleanup()` is called. Re-rendering after a zoom is debounced and the old bitmap stays on screen, stretched, until the new one is ready. Canvases render at `devicePixelRatio` (capped at 20 megapixels per page), so no tiling is needed up to 400%.

## The interface

`packages/reader/src/engine.ts` holds the final types. In short:

- `ReaderEngine.open(source, { requestPassword, assetBaseUrl, signal }) → ReaderDocument`. Errors are `ReaderError` with a friendly `message` and the engine's `details`. A password is requested through a callback and lives only in memory.
- `ReaderDocument`: `pageCount`, `fingerprint()`, `pageGeometry(page)`, `renderPage(page, canvas, { scale, pixelRatio, signal })`, `pageText(page) → { text, runs }`, `search(query) → AsyncIterable<SearchHit>`, `outline()`, `title()`, `releasePage(page)`, `destroy()`.

Differences from the sketch in ARCHITECTURE §4, and why:

| Sketch | Final | Reason |
|---|---|---|
| `pageSize` sync | `pageGeometry` async, cached | PDF.js loads a page through its worker |
| `renderPage(page, scale, target)` | adds `pixelRatio` and an abort signal | sharp rendering and cancel on fast zoom or scroll |
| `pageText → { text, charBoxes }` | `{ text, runs }` | PDF.js gives per-run geometry, not per-character boxes; partial runs are measured |
| `selectionToTarget`, `targetToViewport` on the engine | free functions: `selectionToTarget` in the viewer, `pageToViewport` in annotation-model | they need no engine, only runs and the DOM |
| `existingAnnotations()` | not in this version | import of existing annotations is a later work package; additive |

## Risks

- **Main-thread painting.** PDF.js's operator-list rendering runs on the main thread. A page that is very heavy (large vector maps, huge images) can hold it for tens or hundreds of milliseconds. Mitigations: one render at a time per page, cancellation, a render window of five pages. Dropped-frame and memory suites are a follow-up; if they fail, move rendering to an `OffscreenCanvas` worker or reopen EmbedPDF.
- **Text accuracy.** Selection geometry is derived from PDF.js text items and font ascent and descent, not per-glyph boxes. Partial selections inside one run are proportional approximations; whole-run and whole-line selections are exact (ruler fixture, 0.000 pt error). Fonts that PDF.js reports with default metrics, and justified or tightly kerned text, can be a point or two off at a run's inner edges.
- **No range loading** in the first version: the whole file is fetched before opening (the bytes are also hashed for the fingerprint). Revisit with OPFS caching and `PDFDataRangeTransport` for the 50 MB first-open budget.
- **Assets.** Fonts, CMaps, wasm decoders and ICC profiles (about 4 MB) are copied from `node_modules` to `public/pdfjs` at dev and build time and are git-ignored.
- **Chrome minimum font size** and CSS `text-size-adjust` can distort the transparent text layer's width fit in unusual browser settings. It only affects where the invisible text sits, not stored coordinates.
- **Pinch on touch screens** is not handled specially (ctrl + wheel and trackpad pinch are); native touch pinch is a follow-up.

## Consequences

- The only file that imports `pdfjs-dist` is `packages/reader/src/pdfjs-engine.ts`, and it does so lazily (the library touches DOM globals at import and must not run during SSR).
- One new dependency: `pdfjs-dist` (Apache-2.0, about 400 KB gzipped for the library; the worker loads separately).
- Later work packages build on: the overlay slot and `onSelection` (P09), `initialPosition` and `onPositionChange` (P08), `ReaderDocument.pageText` and `search` for find and, later, chunk alignment for AI citations.
