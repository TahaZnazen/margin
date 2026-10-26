# P10 — Annotations panel & notebook

> Wave 7 · Needs: P09 · Parallel with: P11 · Run: `Execute prompts/P10-panel-notebook.md`

## Read first
`CLAUDE.md` · `prompts/README.md` · `docs/PRODUCT.md` (Capture row, UX principle 3) · `docs/design/reader-layout.md` · `docs/PROGRESS.md`

## Goal
Everything you captured is easy to review, organize and turn into your own notes, and every item is one click from its exact spot in the book.

## Build
1. **Right panel** in the reader with tabs **Annotations | Notebook** (a sheet on mobile).
2. **Annotations tab:**
   - list grouped by chapter (from the outline) with page numbers, or a flat list by page
   - filters by color (with counts), kind and tag; text search over quote and comment
   - each item shows the color chip, quote (clamped), comment, tags and page
   - clicking an item calls `jumpTo()`; hovering outlines it on the page; items currently on screen are marked
   - an **Orphaned** section with "Place again": the user selects new text and the annotation re-anchors there
   - virtualized, so 1,000 items scroll smoothly
3. **Notebook tab:** one notebook per book (a `notes` row with `document_id`, created on first use), built with Tiptap using MIT extensions only: headings, lists, task lists, bold/italic/code, links, blockquote, and a `/` slash menu.
   - Custom node **`annotationQuote {annotationId, quoteSnapshot, color, page}`** shows the live quote with a color bar and page chip; clicking it jumps and flashes.
   - Insert one by dragging from the Annotations tab, or with `/quote` (a searchable picker).
   - If the annotation was deleted, the node shows "highlight deleted" with the snapshot text.
   - Autosave (500 ms debounce) to `doc_json` + derived `plain_text`.
4. **Backlinks:** the highlight popover and list item show an "In notebook" marker when the annotation is referenced.
5. **`/app/notes`:** all book notebooks plus standalone notes (`document_id` null), searchable over `plain_text`; create, rename and delete standalone notes with the same editor.
6. **Tags:** rename a tag across all annotations (keep it minimal).
7. **E2E:** create highlights → filter → jump and flash; drag one into the notebook → reload → it still links; delete the highlight → the node degrades gracefully; notes sync to a second context.

## Acceptance criteria
- [ ] Clicking any annotation or notebook quote opens its exact location and flashes it.
- [ ] 1,000 annotations in the list scroll smoothly (virtualized).
- [ ] Notebook edits survive a reload and sync to a second context, including edits made offline.
- [ ] Orphaned annotations can be placed again.

## Out of scope
Export (P11), AI, cards.
