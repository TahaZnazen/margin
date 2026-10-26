# P09 — Annotation layer

> Wave 6 · Needs: P08 · Run: `Execute prompts/P09-annotations.md`

## Read first
`CLAUDE.md` (principles 1 and 3) · `prompts/README.md` · `docs/ARCHITECTURE.md` §4, §5.3 · `docs/PRODUCT.md` (semantic colors, UX principles) · `docs/design/reader-layout.md` · `docs/PROGRESS.md`

## Goal
Highlighting feels instant and never drifts: select, press a key, done. The highlight then appears on every device, at every zoom.

## Build
1. **Rendering:** in the P07 overlay, a live query of the document's annotations → `targetToViewport` → positioned rects in the theme-correct palette (P03), drawn only on rendered pages. Annotations with a comment get a small margin marker.
2. **Create:**
   - On selection, show the popover (P03 spec): 5 color dots (tooltip = the user's label), Note, and Copy with citation (`"quote" — Title, p. N`).
   - **Keys 1–5** apply a color to the current selection instantly, without opening anything.
   - A selection that spans pages becomes one annotation with several segments. Fill `page_start` and `quote_text`.
3. **Edit:** clicking or tapping a highlight opens the popover in edit mode: change color, add or edit the comment (inline, autosaved), tags (free text with autocomplete from existing tags), delete. Keys: `N` comment, `Delete` / `Backspace` delete, `J` / `K` next or previous highlight (scrolls to it), `Esc` close.
4. **Undo/redo** (ctrl/cmd+Z, shift+ctrl/cmd+Z) for create, update and delete within the session.
5. **Area highlights:** `A` toggles area mode (Alt+drag also works). Drawing a rectangle creates a `kind: area` annotation, renders that region to a 2× PNG, uploads it through `StorageProvider` to `{userId}/{documentId}/snapshots/{annotationId}.png`, and sets `snapshot_path`. Areas render as outlined boxes.
6. **Bookmarks:** `B` toggles a bookmark on the current page. It shows as a margin ribbon and in the left rail under "Bookmarks".
7. **Jump API:** `jumpTo(annotationId)` scrolls to an annotation and flashes it twice. `/app/read/[id]#a=<annotationId>` opens the book at that annotation. P10 and P11 rely on this.
8. **Re-anchoring:** add `reanchor(target, getPageText)` to `annotation-model` using approx-string-match (add it as that package's second dependency; ARCHITECTURE names it). This is an additive API, so it's no contract change. When a book opens and an annotation's fingerprint ≠ the document's sha256, re-anchor within ±3 pages, then update the rects and `anchor_status`. Orphans show as a badge that opens a dialog for now; P10 gives them a proper home.
9. **Reserved:** the popover's Explain and Make card slots exist in code but don't render while `flags.ai` is false.
10. **Tests:** Playwright visual regression on corpus files. Create highlights on known sentences, reload, check at 50 / 100 / 200 / 300% and on rotated pages. Take dark and sepia screenshots.

## Acceptance criteria
- [ ] After reload and at every zoom and rotation, highlight rects sit within **≤ 1 px** of the text.
- [ ] Highlight creation → visible and stored locally in **< 50 ms** (performance mark).
- [ ] 500 highlights in one book → scrolling still ≤ 5% dropped frames.
- [ ] Highlights made offline appear on a second context after reconnecting.
- [ ] Re-anchoring test: the same text in a modified PDF (e.g. a page inserted before it) is found and re-placed; text that was removed is marked orphaned, never deleted.
- [ ] `#a=<id>` deep links open the right spot and flash it.

## Out of scope
The annotations list and notebook (P10), import/export (P11), AI buttons.
