# P07 — Reader core

> Wave 4 · Needs: P03, P04 (ADR-0003 accepted) · Parallel with: P06 · Run: `Execute prompts/P07-reader-core.md`

## Read first
`CLAUDE.md` (principle 3) · `prompts/README.md` · `docs/adr/0003-reader-engine.md` · `docs/ARCHITECTURE.md` §4, §7 · `docs/design/reader-layout.md` · `packages/reader/src/engine.ts`

## Goal
A reader that feels instant and smooth on every PDF in the corpus, built on the engine chosen in ADR-0003.

## Build
1. **Implement `ReaderEngine`** in `packages/reader` for the chosen engine, with parsing and rendering off the main thread.
2. **`<PdfViewer>`**:
   - virtualized vertical scrolling: render the visible pages ±2, and release memory for distant pages
   - pages sized correctly before they render, so nothing jumps
   - zoom: fit width, fit page, 50–400%, ctrl/cmd + wheel, pinch
   - sharp at high zoom (tiling, or re-render at `devicePixelRatio`)
   - a text layer for selection
3. **Navigation:** outline sidebar, lazy thumbnails, go-to-page, find in document (all hits highlighted, next/previous, count). Keyboard: arrows, PageUp/PageDown, Space, Home/End, `[` / `]` for previous/next chapter, `/` or ctrl+F to find, `+` / `-` to zoom.
4. **Themes:** light (as-is), sepia (warm tint), dark (dimmed or inverted page with natural-looking images, following ADR-0003). Document the trade-off.
5. **Position API:** `initialPosition {page, offsetPt, zoom}` and a debounced `onPositionChange`. P08 wires these to `reading_state`.
6. **Overlay and selection APIs** for P09:
   - a per-page overlay slot whose children receive the page → viewport transform from `annotation-model`
   - `onSelection(target | null)`, emitting an `AnnotationTarget` (merged line rects + quote) built through `selectionToTarget`. Selections spanning pages produce multiple segments.
7. **Errors:** password prompt (the password stays in memory only); corrupted file → a friendly error with details.
8. **Dev route** `/dev/reader?fixture=<id>` that loads corpus files (dev only).
9. **Playwright suite over the corpus:** first-page time, dropped frames while scrolling, find accuracy, and selection → target accuracy against the ruler PDF.

## Acceptance criteria
- [ ] ARCHITECTURE §7 budgets met: first page < 300 ms cached and < 2 s on first open (50 MB, local network); scrolling ≤ 5% dropped frames; < 500 MB memory on the largest file.
- [ ] Selecting text on the ruler PDF yields rects within **1 pt** of the known coordinates at 50 / 100 / 200 / 300% zoom and on all 4 rotations.
- [ ] Outline, thumbnails, find and every shortcut pass E2E.
- [ ] The password and corrupted fixtures are handled gracefully; the JS fixture runs no script.
- [ ] Selection and find work correctly on the Arabic and French fixtures.

## Out of scope
Library, upload, saving highlights (P09), saving position (P08).
