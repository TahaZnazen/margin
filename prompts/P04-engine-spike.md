# P04 — Reader engine spike (time-boxed)

> Wave 3 · Needs: P01 · Parallel with: P05 · Run: `Execute prompts/P04-engine-spike.md`

## Read first
`CLAUDE.md` · `prompts/README.md` · `docs/ARCHITECTURE.md` §2, §4, §7 · `fixtures/pdfs/README.md`

## Goal
Choose the PDF engine using measurements, not opinions, and lock the `ReaderEngine` interface.

## Build
1. In `spikes/engine/` (excluded from the workspace build; throwaway quality is fine), build two minimal viewers over the same corpus: **EmbedPDF** (PDFium WASM) and **PDF.js** (`pdfjs-dist`). Each one needs virtualized scrolling, zoom, text selection, and access to per-character boxes for a selection.
2. Measure both engines on the P01 corpus, automating with Playwright where possible:
   - time to first page, cold and cached, on the 600-page textbook and the ≥ 100 MB file
   - memory after scrolling through the largest document
   - scroll smoothness (% dropped frames during a scripted scroll)
   - **selection fidelity:** on the two-column paper, the Arabic document and the French document, does the extracted text match? On the ruler PDF, do the character boxes land within 1 pt of the known coordinates?
   - rotated and mixed-size pages, including the CropBox offset
   - password PDF, corrupted file (fails gracefully), JavaScript-bearing PDF (no script runs)
   - range / progressive loading support
   - reading existing annotations (QuadPoints, color, contents) from the generated file
   - rendering inside a Web Worker / OffscreenCanvas
   - bundle and WASM size, license, maintenance activity (releases in the last 6 months)
   - touch text selection on mobile Safari or Chrome (if no device is available, say so)
3. Decide how highlights get drawn: **our own overlay layer** (the default, which keeps the data model ours) or the engine's annotation layer. Justify the choice.
4. Write `docs/adr/0003-reader-engine.md` containing a results table for both engines, the decision, risks, and the final `ReaderEngine` TypeScript interface. Start from ARCHITECTURE §4 and adjust the signatures to what the winning engine can really do. Put the interface (types only) in `packages/reader/src/engine.ts`.
5. Present the recommendation to the user. Once they accept, set the ADR status to Accepted and update its row in ARCHITECTURE §11.

Stop once the comparison is complete; don't polish spike code.

## Acceptance criteria
- [ ] Every measurement has numbers for both engines (or "not supported") in the ADR.
- [ ] `packages/reader/src/engine.ts` compiles, and every method is documented.
- [ ] The user accepted the decision.

## Out of scope
The production viewer (P07).
