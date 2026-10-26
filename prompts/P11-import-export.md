# P11 — Import & export

> Wave 7 · Needs: P09 · Parallel with: P10 · Run: `Execute prompts/P11-import-export.md`

## Read first
`CLAUDE.md` (principle 5) · `prompts/README.md` · `docs/ARCHITECTURE.md` §4 (Export, Import) · `docs/PROGRESS.md`

## Goal
Your highlights are never locked in. Bring existing highlights in, and take everything out in formats other tools can read.

## Build
1. **Import on upload.** After a document becomes readable (hook into P08), read the PDF's existing annotations through the engine:
   - Highlight, Underline, Squiggly and StrikeOut become highlights.
   - Square becomes an area.
   - A Text (sticky) note becomes a bookmark with a comment.
   Convert QuadPoints and Rect from PDF user space (bottom-left origin, CropBox offset, `/Rotate`) into our coordinates. Extract the quote from the text under the rects, map each color to the nearest semantic color, and keep `/Contents` as the comment. Set `documents.annotations_imported_at` so the import runs once, then show a toast like "Imported 37 highlights".
2. **Markdown export** per book:
   - YAML frontmatter: title, author, exported_at
   - annotations grouped by chapter, each as a blockquote with color label, page, comment, tags, and a deep link `<app-url>/app/read/<documentId>#a=<annotationId>`
   - then the notebook converted to Markdown (quote nodes become linked blockquotes)
   It must be Obsidian-friendly: no raw HTML.
3. **Annotated PDF export** per book: a copy of the original with real annotations added via pdf-lib:
   - highlights → `/Highlight` with `/QuadPoints` (one quad per rect, correct point order), `/C`, `/CA`, `/Contents`, `/T`, `/M`
   - areas → `/Square`
   - bookmarks → outline entries or `/Text` notes (pick one and document why)
   The coordinate conversion handles CropBox offsets and `/Rotate`.
4. **Export everything** (Settings → Data): a zip (fflate) containing every book's Markdown, a versioned JSON dump of all the user's rows, and optionally the PDFs. This is the backup on the free plan.
5. **Round-trip test:** export an annotated PDF → import it as a new document → every highlight comes back within **1 pt**, with the same quote and color. Run it on the generated rotated / mixed-size file and on two corpus files.
6. A manual checklist in PROGRESS for the user: open the exported PDF in Acrobat Reader, Chrome, Zotero, and macOS Preview if available.

## Acceptance criteria
- [ ] Importing the generated annotated fixture reproduces its annotations (positions within 1 pt, colors mapped, comments kept).
- [ ] The round-trip test passes on all three files.
- [ ] The Markdown export opens cleanly in Obsidian, and its deep links open the exact highlight.
- [ ] The export-everything zip contains every table's rows and every book's Markdown.

## Out of scope
Restoring from the zip (follow-up), Notion/Readwise sync, Anki (Phase 3).
