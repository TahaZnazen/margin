# R01 — Competitor gap analysis (non-AI features)

> Research run · 2026-10-31 · live app https://margin-one-beta.vercel.app · 10 competitors · AI features are out of scope (Appendix A lists them only)

## 1. Summary for the founder

Margin is already a solid reader. Upload is fast: a 2.4 MB paper was readable 1.4 seconds after picking it. Highlights appear instantly, have meaning (key idea, definition, …), sync between devices and survive going offline. Export is better than most apps.

Compared with the big apps, the gaps are mostly about **finding your way around a book** and **seeing your progress**, not about annotation:

- **You can't search the text of a book.** Ctrl+F opens no Margin search; at best the browser's own find runs, and it sees only the few pages currently drawn. Every one of the 10 competitors has find-in-book. Margin's viewer already has a find feature; it's just not switched on in the real reader.
- **Links inside the PDF don't work.** Clicking "[5]" or "see Chapter 3" does nothing, and there is no Back button. All 10 apps support this, at least partly.
- **You can't see how far along you are** beyond a thin bar: no "page 5 of 9", no "12 minutes left", no "to read / finished".
- **Your highlights stay inside each book.** There is no page that shows every highlight from every book, no tags, and no daily review that brings old highlights back.
- **On a phone, two-column papers are too small to read.** There is no text mode yet.

**No competitor offers "mark chapter as done".** It would be a small, visible feature that is unique to Margin and fits the exam-study audience. It needs one new table, which means an ADR first.

**Top 10 to add next**

| # | Feature | Why | Effort |
|---|---|---|---|
| 1 | **Find in this book** (Ctrl+F, next/previous) | Every competitor has it; the code already exists | S |
| 2 | **Time left and page numbers**: "p. 5 of 9 · 12 min left" in the library, page numbers in the chapter list | Answers "how long until I'm done?" at a glance | S |
| 3 | **Better titles and bookmark names**: title from the first page, bookmarks named after their chapter | Today you see "arxiv-2210.13502v1" and "Page 1" | S |
| 4 | **Focus mode**: one key hides everything except the page | Calm reading; 10 of 10 apps have a full-screen mode | S |
| 5 | **Copy with link**: a copied quote includes a link that opens that exact spot | Builds on Margin's passage-exact links | S |
| 6 | **Mark chapter as done** (✓ in the chapter list, "4 of 12 chapters" in the library) | Unique to Margin; the study habit made visible | M + ADR |
| 7 | **Clickable links + Back button** inside the PDF | Papers and textbooks are full of links | M |
| 8 | **All highlights page**: search and filter every highlight across every book | 6 of 10 apps have it; your highlights become a knowledge base | M |
| 9 | **Shelves and reading status** (To read / Reading / Finished) | 10 of 10 apps organize books; the tables already exist | M |
| 10 | **Tags on highlights** | 6 of 10 apps have it; the column already exists | M |

The next ten (daily highlight review, figure snapshots, sticky notes, two-page view, share as an image, text mode for phones, …) are listed in section 5.

## 2. Decisions I made

1. **Lineup.** I kept the 10 apps from the prompt. I counted "Kindle" as one column covering the Kindle apps and the Kindle Scribe, because Amazon documents PDF support per device in one table.
2. **Isolated browser.** The Playwright browser profile opened straight into a signed-in session (likely yours). I didn't look at it or sign it out. I deleted the one accessibility snapshot the first navigation wrote automatically, without reading it, and did the whole walkthrough in a separate, fresh browser context as the temporary user.
3. **Temporary account.** I created `e2e-review-…@example.com` with the same admin call as `createUser("review")`, uploaded two fixtures (`arxiv-2210.13502v1.pdf` and the generated `annotations.pdf`), then deleted 4 storage objects and the user. A database query confirmed 0 `e2e-review-*` users and 0 rows for that user id in `documents`, `reading_state`, `annotations`, `notes` and `user_settings`. Older `e2e-*` users were left alone.
4. **Sources.** I read competitor pages through web search excerpts of their official help centers, docs, changelogs and App Store listings. I didn't open them in a full browser and didn't create accounts or trials. Where a vendor page was undated or old, or only a review covered a feature, Appendix B tags the source **review**.
5. **Matrix symbols.** For competitors: ● has it, ◐ partial (paid tier only, one platform only, or limited), · not found in their docs. "Not found" isn't proof that a feature is absent. The "how common" count is ● plus ◐.
6. **"Planned" (📅)** means the feature is named in `docs/PRODUCT.md` or `docs/ROADMAP.md`, even if far off (Phase 3 or the Phase 4 parking lot).
7. **Read-aloud** counts as non-AI when it uses the browser's built-in speech (Web Speech API). A dictionary lookup counts as non-AI when it's a lookup and not a generated explanation.
8. **Effort** assumes one agent working on the existing code: S = under a day, UI only; M = 1–3 days; L = more than 3 days.
9. **"Mark chapter as done" doesn't mark chapters automatically by default.** It suggests at the end of a chapter instead (reasons in §5.5).
10. **Prompt stubs** are numbered Q1–Q5 (quick wins) and C1 (chapters) so they don't collide with the P-series.

## 3. What Margin has today

Screenshots are in `evidence/r01/` (git-ignored). Desktop is 1440 px wide, phone is 390 px. ✓ works · ⚠ confusing, broken or missing from a reader's point of view.

**Sign-in** (`01`, `37`)
- ✓ Email + password, magic link. Sign-up hidden (locked).
- ⚠ No "forgot password" link (the magic link covers it, but that isn't obvious).

**Library** (`02`, `17`, `18`, `19`, `30`)
- ✓ Grid and list views, cover thumbnails, search by title or author, sort by Recent / Title / Progress, drop-anywhere upload, a progress bar per book, an "available offline" cloud badge.
- ✓ Book menu: Keep offline, Rename or edit author, Delete (with undo).
- ⚠ The title falls back to the file name ("arxiv-2210.13502v1") when the PDF has no title metadata, even though page 1 shows a clear title.
- ⚠ The progress bar has no number: no page, no percent, no time left.
- ⚠ No shelves or collections, no reading status, no filter (for example "unfinished").

**Upload** (`04` shows the tray)
- ✓ Readable 1.4 s after picking a 2.4 MB file (the reader opens before the upload finishes). Duplicate detection by file hash.
- ✓ Existing PDF annotations are imported once (`20`: "Imported 2 highlights and 1 note").
- ⚠ The upload tray overlaps the bottom right of the page in the reader until it auto-dismisses.

**Reader** (`04`–`09`, `13`, `14`, `31`–`34`)
- ✓ Fit width or fit page, zoom buttons, ctrl+wheel, pinch on phones, light / sepia / dark / system themes, resume at the exact position across devices (reopened at page 5 on the phone), `g` go to page, `[` / `]` previous / next chapter, a "Next chapter" pill at the end of a chapter, current chapter under the title, a chapter progress line.
- ✓ Left sidebar: **Chapters** (nested outline or guessed headings, current one highlighted, "Copy link" per chapter), **Pages** (thumbnails), **Bookmarks**.
- ⚠ **Ctrl+F opens no Margin search** (the browser's own find only sees the 3–5 pages that are rendered). The viewer has a find feature (`PdfViewer` `find`/`findNext`/`findPrev`) but only the dev page (`/dev/reader`, 404 in production) shows a find bar. The command palette searches highlights, not the book's text.
- ⚠ **Links inside the PDF aren't clickable.** On the arXiv paper, citations like "[5]" and equation references do nothing; I counted 0 link elements on the page. There is also no Back button.
- ⚠ The chapter list has no page numbers (the command palette does show them), no "done" state and no highlight counts.
- ⚠ Bookmarks are listed as "Page 1": no chapter name and no label.
- ⚠ Opening the sidebar re-fits the page (171 % → 135 %), so the text jumps.
- ⚠ On a phone, a two-column paper at fit-width is 42 % and unreadable; zooming in means scrolling sideways. No text mode.
- ⚠ No focus or full-screen mode on desktop (the phone top bar does hide on scroll).
- ⚠ No two-page spread and no page-by-page mode.

**Highlight, comment, bookmark, undo** (`05`, `06`)
- ✓ The selection popover has 5 meaning-colors with labels, Note, and Copy with citation. Keys 1–5, N, Shift+C, B. Clicking a highlight edits it (recolor, autosaved comment, Delete). Overlapping highlights merge. Ctrl+Z / Ctrl+Shift+Z undo and redo (verified: 8 → 7 → 8). A comment marker shows in the margin.
- ⚠ The comment box opens above the highlight and covers the line above it (here, another highlight).
- ⚠ "Copy with citation" copies `"quote" — title, p. N` with no link back to the passage.
- ⚠ Not built: underline style, area/figure snapshots, sticky notes placed anywhere on the page, tags.

**Annotations panel** (`10`, `33`)
- ✓ Grouped by chapter, color filter chips with counts, text search over quote + comment, click to jump with a flash, hover outlines the highlight, Add to notebook, delete.
- ⚠ It groups by the top-level outline entry only. In this paper the top level is the title, so every highlight lands in one group.
- ⚠ The color filter chips are announced as "2", "1", "1"…: a screen reader can't tell which color is which.
- ⚠ No multi-select (recolor or delete several at once).

**Notebook and Notes** (`11`, `21`, `35`)
- ✓ One notebook per book (Tiptap: headings, lists, tasks, links), highlights dropped in as linked quote blocks in their color with a page chip, click to jump. `/app/notes` lists book notebooks and standalone notes, with search.
- ⚠ Book notebooks are read-only previews in `/app/notes`. There's no way to search highlights across books there.

**Export and import** (`12`, `22`)
- ✓ Per book: Markdown (with deep links per highlight) and an annotated PDF (real `/Highlight` annotations). Settings → "Export everything" zip (all tables as JSON + Markdown per book + optional PDFs). Highlights already in a PDF are imported on upload.
- ⚠ No way to restore from the zip. No Anki, Notion or Obsidian sync (Markdown only).

**Settings** (`22`, `36`)
- ✓ Theme, default zoom, rename the 5 highlight labels, Storage on this device (sizes, remove, quota), Install, Data export.
- ⚠ The label fields are titled with internal ids ("key", "memorize") rather than the color.
- ⚠ No account section (change password, change email, delete account).

**Command palette and `?` sheet** (`15`, `16`)
- ✓ Ctrl+K: open a book, chapters with page numbers, highlights and notes of the open book, zoom, panels, theme, navigation. `?` lists the keys that actually work.
- ⚠ No "find text in book" entry, which is what people try first.

**App shell, sync, install, offline** (`23`, `24`, `25`)
- ✓ Sync status ("Synced", explains local-first). The service worker was ready, and a reload with the network off showed the library with both books.
- ⚠ The account menu shows only the email and Sign out. Install shows only when the browser offers it (fine, but invisible on desktop Chrome after install).

**Cross-check with `docs/PROGRESS.md`:** Find (P07 built it, P12 left "wire Ctrl+F" as follow-up 8) is **built but not exposed**, so it's 🟡, not ❌. Collections (tables in P02, no UI) and tags (column in P02, no UI) are 📅. Area highlights (kind exists, P09 skipped the UI) are 📅. Desktop idle fade of the top bar is a known P12 follow-up.

## 4. Feature matrix

Apps: **LT** LiquidText · **MN** MarginNote 4 · **HL** Highlights · **PE** PDF Expert · **RW** Readwise Reader · **KI** Kindle (apps + Scribe) · **AB** Apple Books · **ZO** Zotero 7 · **AC** Acrobat Reader · **RN** RemNote.
Competitors: ● has it · ◐ partial / paid / one platform · · not found in docs. Margin: ✅ has it · 🟡 partial or hard to find · 📅 planned · ❌ missing. **#** = how many of the 10 competitors have it (● + ◐).

| Feature | LT | MN | HL | PE | RW | KI | AB | ZO | AC | RN | **Margin** | # |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Reading** | | | | | | | | | | | | |
| Continuous scroll | ● | ● | ● | ● | ● | ◐ | ◐ | ● | ● | ● | ✅ | 10 |
| Zoom, fit width / page | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ✅ | 10 |
| Sepia / dark themes | ◐ | ● | ● | ● | ● | ● | ● | ● | ◐ | ● | ✅ | 10 |
| Find text in this book | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | 🟡 built, not wired | 10 |
| Follow internal links + Back | ◐ | ◐ | ● | ● | ◐ | ● | ● | ◐ | ● | ◐ | ❌ | 10 |
| Focus / full-screen mode | ◐ | ◐ | ● | ● | ● | ● | ● | ◐ | ● | ◐ | 🟡 phone only | 10 |
| Page-by-page (paged) mode | · | ◐ | ● | ● | · | ● | ● | ● | ● | · | ❌ | 7 |
| Split view / several docs side by side | ● | ● | ◐ | ● | · | · | · | ● | ● | ● | 🟡 browser tabs | 7 |
| Dictionary / translation lookup (non-AI) | · | ◐ | ◐ | ◐ | ◐ | ● | ● | · | · | · | ❌ | 6 |
| Two-page spread | · | · | ◐ | ● | · | · | ◐ | ● | ● | · | ❌ | 5 |
| Read-aloud | · | · | · | ● | ● | ◐ | ◐ | · | ● | · | 📅 | 5 |
| Text / reflow mode for phones | · | · | · | ● | ● | ◐ | · | · | ● | · | 📅 | 4 |
| Footnote / reference preview on hover | · | · | ◐ | · | · | · | · | ● | · | · | ❌ | 2 |
| Auto-scroll | · | · | · | · | · | · | · | · | ● | · | ❌ | 1 |
| **Progress** | | | | | | | | | | | | |
| Continue reading across devices | ◐ | ● | ◐ | ● | ● | ● | ● | ● | ● | ● | ✅ | 10 |
| Per-book progress in the library | · | · | · | ◐ | ● | ● | ● | · | · | · | ✅ bar only | 4 |
| Reading status (to read / reading / finished) | · | · | · | · | ● | ● | ● | ◐ | · | · | ❌ | 4 |
| Time left (chapter / book) | · | · | · | · | ● | ● | ◐ | · | · | · | ❌ | 3 |
| Reading goals and streaks | · | · | · | · | · | ◐ | ● | · | · | ◐ | 📅 WP-32 | 3 |
| Reading-time stats | · | · | · | · | ◐ | ● | ● | · | · | · | 🟡 stored, not shown | 3 |
| **Mark chapter as done** / chapter checklist | · | · | · | · | · | · | · | · | · | · | ❌ | 0 |
| **Annotate** | | | | | | | | | | | | |
| Several highlight colors | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ✅ 5 with meanings | 10 |
| Comment on a highlight | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ✅ | 10 |
| Annotation list with search and filter (one book) | ● | ● | ● | ● | ● | ● | ◐ | ● | ● | ● | ✅ | 10 |
| Ink and stylus | ● | ● | ◐ | ● | · | ● | ◐ | ● | ● | ◐ | 📅 Later | 9 |
| Sticky note anywhere on the page | ● | ● | ● | ● | · | ◐ | · | ● | ● | ◐ | 🟡 bookmark + comment | 8 |
| Area / figure snapshot | ● | ● | ● | · | ● | · | · | ● | ◐ | ● | 📅 Phase 1 | 7 |
| Bulk edit (multi-select) | ● | ◐ | ◐ | ◐ | ◐ | · | · | ● | ◐ | · | ❌ | 7 |
| Underline / strikethrough styles | · | ● | ● | ● | · | · | ● | ● | ● | · | ❌ | 6 |
| Tags on highlights | ● | ● | ● | · | ● | · | · | ● | · | ● | 📅 Phase 1 | 6 |
| Search highlights across all books | ◐ | ● | · | · | ● | ◐ | · | ● | · | ● | ❌ | 6 |
| Link annotations to each other | ● | ● | · | · | · | · | · | ◐ | · | ● | 🟡 via notebook | 4 |
| Excerpt workspace / canvas | ● | ● | · | · | · | · | · | · | · | ◐ | 🟡 linear notebook | 3 |
| Mind map | ● | ● | · | · | · | · | · | · | · | · | ❌ | 2 |
| **Organize** | | | | | | | | | | | | |
| Collections / shelves / folders | ● | ● | ● | ● | ● | ● | ● | ● | ◐ | ● | 📅 tables exist | 10 |
| Sort and search the library | ● | ● | ● | ● | ● | ● | ● | ● | ◐ | ● | ✅ | 10 |
| Edit title, author, cover | ◐ | ◐ | ◐ | ◐ | ● | ◐ | ● | ● | · | ◐ | 🟡 no cover | 9 |
| Other formats (EPUB, web, Office) | ● | ● | · | ◐ | ● | ● | ● | ● | ◐ | ◐ | 📅 Phase 4 | 9 |
| Tags on books | · | ◐ | ● | ◐ | ● | · | · | ● | · | ● | ❌ | 6 |
| Duplicate detection | · | · | · | · | ◐ | · | · | ● | · | · | ✅ | 2 |
| **Review (non-AI)** | | | | | | | | | | | | |
| Manual flashcards from highlights | · | ● | · | · | ● | ● | · | · | · | ● | 📅 Phase 3 | 4 |
| Spaced repetition | · | ● | · | · | ● | · | · | · | · | ● | 📅 Phase 3 | 3 |
| Anki export | · | ● | · | · | ◐ | · | · | · | · | · | 📅 WP-34 | 2 |
| Daily highlight resurfacing | · | · | · | · | ● | · | · | · | · | · | ❌ | 1 |
| **Get data in and out** | | | | | | | | | | | | |
| Markdown export | ◐ | ● | ● | ◐ | ● | ◐ | ◐ | ● | · | ● | ✅ | 9 |
| Annotated (flattened) PDF export | ● | ● | ● | ● | ● | ◐ | · | ● | ● | ◐ | ✅ | 9 |
| Full data export | ◐ | ● | ● | ● | ● | ◐ | · | ● | ● | ● | ✅ (no restore) | 9 |
| Import highlights already in the PDF | ◐ | ◐ | ● | ● | · | · | · | ● | ● | · | ✅ | 6 |
| Share a highlight as an image or link | · | · | ◐ | · | ● | ● | ● | ◐ | · | · | 🟡 own-account link | 5 |
| Notion / Obsidian sync | · | ◐ | ◐ | · | ● | · | · | ◐ | · | · | 🟡 Markdown only | 4 |
| Zotero import / integration | · | ◐ | ◐ | · | ● | · | · | ● | · | · | 🟡 via annotated PDF | 4 |
| Citations / BibTeX | · | ◐ | ● | · | · | · | · | ● | · | · | 🟡 title + page | 3 |
| Kindle highlight import | · | · | · | · | ● | · | · | · | · | · | ❌ | 1 |
| **Platform** | | | | | | | | | | | | |
| Works offline | ● | ● | ● | ● | ◐ | ● | ● | ● | ● | ● | ✅ | 10 |
| Send to app (email, share sheet) | ● | ● | ● | ● | ● | ● | ● | ◐ | ● | ◐ | ❌ | 10 |
| Keyboard shortcuts / command palette | ◐ | ◐ | ● | ● | ● | ◐ | ◐ | ● | ● | ● | ✅ | 10 |
| Accessibility (screen reader, contrast) | ◐ | ◐ | ◐ | ◐ | ◐ | ● | ● | ◐ | ● | ◐ | 🟡 | 10 |
| Open data / standard PDF annotations | ◐ | ◐ | ● | ● | ● | ◐ | · | ● | ● | ◐ | ✅ | 9 |
| Windows + Android coverage | ● | · | · | ◐ | ● | ● | · | ● | ● | ● | ✅ PWA | 7 |
| Runs in a browser, no install | · | · | · | · | ● | ◐ | · | ◐ | ● | ● | ✅ | 5 |
| Browser extension / web clipper | · | · | · | · | ● | ◐ | · | ● | · | ● | ❌ | 4 |

**What stands out**
- **Table stakes Margin lacks** (8+ competitors): find in book (built, not wired), internal links + Back, sending a file in from email or the share sheet, sticky notes, collections (planned).
- **Where Margin is already ahead:** meaning-colors, readable in about 1 s from a web link, local-first sync, offline in a browser, real `/Highlight` export plus re-import, full data export. Of the 10, only Readwise, Acrobat and RemNote also run in a browser (Kindle and Zotero partly), so "open a link, read in about a second, keep working offline" is a real edge.
- **Nobody has "mark chapter as done".** Kindle, Readwise and Apple Books come closest with "time left in chapter".

## 5. Recommendations

Each entry covers what it is, who has it and why it matters, the effort and the files, whether it changes a contract, and how it fits the principles (local-first, never block reading, PDF-coordinate annotations, user owns the data). Unless an entry says otherwise, it fits all four.

### 5.1 Quick wins (S, no contract change)

**Q1. Find in this book.** Press Ctrl+F (or the search icon) to search the book's text, with "3 of 17" and next/previous.
- *Who:* all 10. *Why:* the first thing any reader tries. Finding "that passage" again is one of the problems listed in PRODUCT.md. As a portfolio piece, it shows the engine is complete.
- *Effort:* S. `PdfViewer` already has `find`, `findNext`, `findPrev` and highlights every hit (the `/dev/reader` find bar is the reference). Touches `read/[documentId]/reader-client.tsx` (find bar in the header, Ctrl/Cmd+F, Enter / Shift+Enter, Esc), `components/command-palette.tsx` ("Find in book…"), the `?` sheet.
- *Contract:* none.

**Q2. Time left and page numbers.** The library card shows "p. 5 of 9 · 56 % · about 12 min left". The chapter list shows each chapter's first page and "8 min" for the current chapter.
- *Who:* RW, KI, AB (time left); MN, PE, ZO, AC (page numbers in the outline). *Why:* "how long until I'm done?" is the daily study question, and it makes progress visible without a new feature.
- *Effort:* S. Pace = `reading_state.seconds_read` ÷ pages advanced (shown after 3+ pages read; before that, nothing). Touches `library-view.tsx`, `reader-sidebar.tsx`, `lib/documents` (add `page`, `seconds_read` to the library query, additively).
- *Contract:* none (columns exist).

**Q3. Better titles and bookmark names.** When a PDF has no title metadata, use the biggest line on page 1 as the title (still editable). A bookmark is listed as "II Preliminaries · p. 2" instead of "Page 1", and its comment is shown as its name.
- *Who:* RW, ZO (metadata from the document); PE, AB (named bookmarks). *Why:* the library looks broken with file-name titles. Bookmarks you can't tell apart are useless.
- *Effort:* S. `packages/reader/src/derive-outline.ts` already finds large-font lines. Touches `upload-provider.tsx` (title fallback), `reader-sidebar.tsx` (bookmark label from the outline + comment).
- *Contract:* none.

**Q4. Focus mode.** `F` (or a button) goes full-screen and hides the header and sidebars until the mouse reaches the top edge. Esc leaves.
- *Who:* 10 of 10 (as full-screen or reading mode). *Why:* "reader chrome fades while reading" is a PRODUCT.md UX principle that is only half built. The desktop idle fade is a P12 follow-up.
- *Effort:* S. Touches `reader-client.tsx`, Fullscreen API, the `?` sheet and the palette.
- *Contract:* none.

**Q5. Copy with link.** "Copy with citation" adds a link: `"quote" — Title, p. 5 · https://…/app/read/<id>#a=<highlight>` (or `#p=` for an unsaved selection). The annotations panel gets "Copy link" per highlight.
- *Who:* ZO (annotation links), RW, KI, AB (share quote). *Why:* passage-exact links are Margin's unique strength (PRODUCT "context restore everywhere"). Pasted into Obsidian, Notion or a chat with yourself, the link jumps back to the exact spot.
- *Effort:* S. Touches `use-annotation-layer.tsx` (`copyCitation`), `side-panel.tsx`.
- *Contract:* none.

**Also S, folded into the stubs above or small enough to do in any pass:**
- Color filter chips get accessible names ("Key idea, 2") (`side-panel.tsx`). Do it with Q1.
- The annotations panel groups by the deepest outline level that splits the highlights (or detected headings), not only the top level. That's PROGRESS "left for later" (6). (`side-panel.tsx`, `lib/export/markdown.ts`).
- Settings label fields show the color swatch and name, not the internal id (`settings-form.tsx`).
- The comment box opens below the highlight when it would cover another one (`annotation-popover.tsx`).
- Keep the zoom percentage (not the fit) when the sidebar opens, so the text doesn't jump (`reader-client.tsx`).
- **Look up** in the selection popover: opens the word in a dictionary or Wikipedia in a new tab (non-AI; 6 apps have a dictionary). (`annotation-popover.tsx`)

### 5.2 Next

**N1. Mark chapter as done.** Full entry in §5.5. M, **needs ADR 0004**.

**N2. Clickable links + Back button.** Links inside the PDF (citations, "see section 3", the book's own table of contents, URLs) work. A "← Back to p. 2" pill appears after a jump; Alt+Left also goes back.
- *Who:* 10 of 10 (◐ for some). *Why:* papers and textbooks are built on cross-references. Today a reader has to scroll and guess. This is a "feels like a real PDF reader" moment.
- *Effort:* M. Additive `ReaderDocument.links(page)` in `packages/reader/src/engine.ts`, read from PDF.js `getAnnotations()` in `pdfjs-engine.ts` (Link subtype, `dest` / `url`). A link layer in `PdfViewer.tsx` that must sit *above* the text layer only on the link rectangles (so selection still works). A history stack in `reader-client.tsx`. External URLs open in a new tab with `rel="noopener"`, and `javascript:` is never followed (security: the corpus has `javascript-forms.pdf`).
- *Contract:* none (the engine interface is not a frozen contract; additive). *Then:* footnote preview on hover (ZO) becomes a small follow-up.

**N3. All highlights page.** `/app/highlights`: every highlight from every book in one list, with search, filter by color, book and tag, sorted by date or book. Click to open the exact spot.
- *Who:* MN, RW, ZO, RN (●); LT, KI (◐). *Why:* this is where highlights become a knowledge base and not a pile ("highlights pile up and are never seen again", PRODUCT.md). It's a strong portfolio screen.
- *Effort:* M. A new route + nav item, a local SQL query over `annotations` joined with `documents` (PowerSync, so it works offline), the command palette searches all highlights. Reuse the panel item component.
- *Contract:* none.

**N4. Shelves and reading status.** Put books on shelves (for example "Pharmacology", "Exam 2") and mark them To read / Reading / Finished. The library gets filter chips.
- *Who:* 10 of 10 have collections; RW, KI, AB have status. *Why:* a library past 20 PDFs needs it. "Finished" is a nice moment for a reader.
- *Effort:* M. `collections` and `collection_documents` already exist and sync, so a `collectionsRepo` (PowerSync) + library UI. Status: **additive option** = three reserved collections (`sort_order` < 0, names fixed); **cleaner option** = a `documents.reading_status` column (contract change, ADR). Recommendation: shelves now with no ADR; for status, wait for the chapter ADR (N1) and add the column there in the same ADR, because "Finished" can then be derived from "all chapters done".
- *Contract:* shelves none; status yes if done as a column (fold into ADR 0004).

**N5. Tags on highlights.** Type `#tag` in a comment, or use a tag field in the highlight popover. Filter by tag in the panel and on the all-highlights page. Tags go into the Markdown export.
- *Who:* LT, MN, HL, RW, ZO, RN. *Why:* colors carry meaning, tags carry topic ("renal", "exam-2"). Together they make highlights searchable the way a student thinks.
- *Effort:* M. `annotations.tags` (jsonb, default `[]`) already exists and syncs. Touches `annotation-popover.tsx`, `side-panel.tsx`, `lib/annotations` (repo writes tags), `lib/export/markdown.ts`, and `lib/pdf-io/export.ts` (tags in `/Contents` as `#tag`, read back on import).
- *Contract:* none.

**N6. Daily highlight review.** A "Today" card in the library shows 5 past highlights (meaning-color first: purple, then red). Click one to open it in the book. Optional: "Keep / Not useful".
- *Who:* RW (its signature feature). *Why:* the cheapest, non-AI step toward the RETAIN stage of the product loop. It builds the habit Phase 3 needs.
- *Effort:* M. Deterministic daily pick (seeded by date + user) from local SQL, so no new storage. "Not useful" could write a tag (`_hidden`) using N5's column.
- *Contract:* none (if feedback is stored as a tag).

**N7. Figure snapshots (area highlights).** Drag a box over a figure or table to save it as an annotation with a picture, shown in the panel, notebook and export.
- *Who:* LT, MN, HL, RW, ZO, RN (+ AC ◐). *Why:* in medicine and engineering the diagram *is* the content, and these snapshots feed image-occlusion cards in Phase 3.
- *Effort:* M–L. The `area` kind, its target rule and `snapshot_path` exist; export already writes `/Square`. Render the snapshot on the fly from the page (no upload needed at first). Touches `use-annotation-layer.tsx`, `annotation-overlay.tsx`, `side-panel.tsx`, the notebook quote node, `lib/pdf-io/import.ts` (Square → area).
- *Contract:* none.

**N8. Sticky notes anywhere on the page.** Click a margin spot to drop a note icon with text, not tied to a highlight.
- *Who:* LT, MN, HL, PE, ZO, AC (+ KI, RN ◐). *Why:* questions to yourself ("ask prof about this figure") don't always have text to highlight.
- *Effort:* M. Fits the existing `bookmark` kind (one segment, ≤ 1 rect, comment allowed) and already exports and imports as `/Text`. It needs a UI to place it and to tell it apart from a page bookmark (bookmark with a rect = sticky note).
- *Contract:* none, but write the "bookmark with a rect means sticky note" rule into `ARCHITECTURE.md` §4 so it's explicit.

**N9. Bulk edit in the annotations panel.** Shift-click or checkboxes to recolor, tag or delete several highlights (one undo step).
- *Who:* LT, ZO (+5 ◐). *Why:* cleaning up after import, or turning a batch yellow → purple before review.
- *Effort:* S–M. `side-panel.tsx`, the store already supports multi-row operations (`createMany`, `merge`).
- *Contract:* none.

**N10. Share as an image.** "Share quote" makes a clean card image (quote, book, page, color bar) with a download or the share sheet.
- *Who:* RW, KI, AB (+ HL, ZO ◐). *Why:* low effort, visible, good for a portfolio and for word of mouth. It shares a quote, never the PDF (copyright, PRODUCT out-of-scope list).
- *Effort:* M. Canvas render, Web Share API with a download fallback.
- *Contract:* none.

**N11. Open PDFs from other apps (share target).** On Android and installed desktop Chrome, "Share → Margin" or "Open with Margin" adds the PDF.
- *Who:* 10 of 10 (native apps). *Why:* getting a PDF in from email or the files app is the first step of the loop.
- *Effort:* M. `share_target` and `file_handlers` in `app/manifest.ts`, a POST handler in the service worker (`apps/web/sw/sw.ts`) that hands the file to the upload provider. iOS Safari doesn't support it (keep the picker).
- *Contract:* none. *Security:* upload path, so it needs a `/security-review`.

**N12. Two-page spread and page-by-page mode.** View → Single / Two pages / Two pages, cover alone; scroll or page-by-page.
- *Who:* paged 7, spread 5. *Why:* textbooks with facing pages and slides read better that way on a wide screen.
- *Effort:* M. Layout math in `PdfViewer.tsx` (virtualization assumes one column), coordinates stay page-based, so annotations are unaffected. Store the choice in `user_settings.reader_prefs` (validated by the app's `ReaderPrefs` zod schema; additive key).
- *Contract:* none.

### 5.3 Later

| Idea | Who has it | Why later | Effort | Contract |
|---|---|---|---|---|
| **Text mode for phones** (reflow) | PE, RW, AC (KI ◐) | Big value on phones, but a good version needs reading order on two-column files (Docling structure, Phase 4). A naive PDF.js text extraction mangles papers. | L | No for display. Highlights made in text mode need a mapping back to PDF rects: design note in ADR |
| **Read-aloud** (browser speech, sentence follow) | PE, RW, AC (KI, AB ◐) | Reading order has the same problem as text mode; do it after reflow | M–L | No |
| **Underline / strikethrough styles** | MN, HL, PE, AB, ZO, AC | Meaning-colors already do the job, and a style field changes the annotation model | M | **Yes**: a `style` column or a field in the target; ADR. Import already maps these to highlights |
| **Ink and stylus** | 9 of 10 | iPad + Pencil audience; the `ink` kind exists with an undefined target | L | **Yes**: ink target schema; ADR (Phase 4 in ROADMAP) |
| **Reading goals, streaks, minutes per day** | AB, KI (RN ◐) | Planned as WP-32; needs a per-day log (today only a running total is stored) | M | **Yes**: a `reading_sessions` table; fold into the Phase 3 ADR |
| **Link highlight ↔ highlight** | LT, MN, RN (ZO ◐) | The notebook already links; direct links matter more after the all-highlights page | M | **Yes**: a links table or a `links` field; ADR |
| **Restore from "Export everything"** | (data ownership) | Completes "users own their data"; rare need for one user | M | No |
| **Kindle highlight import** (My Clippings.txt / notebook export, matched onto your PDF by quote text) | RW | Needs fuzzy re-anchoring (not built yet: P09 follow-up) | L | No |
| **Notion / Obsidian live sync** | RW (MN, HL, ZO ◐) | Markdown export + deep links covers the founder's use | L | No (an integration table later) |
| **Citations: BibTeX / APA from DOI** | HL, ZO (MN ◐) | Valuable for the "grad students" segment, not the beachhead | M | Probably a `documents.metadata` column: ADR |
| **Split view (two books, or two places in one book)** | LT, MN, PE, ZO, AC, RN | Browser tabs already give two books; same-book split is a reader rebuild | L | No |
| **Account settings** (change password or email, delete account) | — | Single user today; needed before beta | M | No (Supabase admin); `/security-review` |
| **EPUB** | 9 of 10 | Phase 4, CFI selectors in the annotation model | L | **Yes** |
| **Browser extension / web clipper** | RW, ZO, RN | Margin is PDF-first | L | No |

### 5.4 Skip

| Idea | Who has it | Why skip |
|---|---|---|
| Mind maps | LT, MN | Big, complex and iPad-centric; PRODUCT positions against "complex" LT/MN. The notebook + all-highlights page cover the need |
| Infinite excerpt canvas | LT, MN | Same reason; it competes with "Respect the page" and a calm reading surface |
| Auto-scroll | AC | 1 of 10; rare for study reading |
| Tabs inside the app | ZO, AC | Browser tabs already do this for a web app |
| Presentation mode | AC | Not a reading or learning need |

### 5.5 Mark chapter as done (full entry)

**What it is:** a check mark next to each chapter that you tick when you've studied it, so you, and the library, can see "4 of 12 chapters done".

**Who has it:** none of the 10. Kindle, Readwise and Apple Books show "time left in chapter", and some single-purpose apps (Bible-reading trackers) have chapter checklists. *Why it matters:* for exam students, "done with chapter 7" is the real unit of progress, not "56 %". It's visible, satisfying and unique, a good portfolio story ("progress you declare, not progress we guess"), and it prepares the Phase 3 "chapter coverage" and "mastery per chapter" (WP-32).

**How it looks**
- **Chapters sidebar:** every row gets a round check on the left (empty circle → filled accent circle with a check; 44 px hit target on touch) and its first page on the right ("p. 12"). Done rows are dimmed slightly, not struck through, so they stay readable. A parent row shows "3/5" while some children are done. Checking a parent checks its children (one undo step); a parent becomes done automatically when all its children are. For a book without an outline, the guessed headings get the same checks, and "This PDF has no table of contents" stays as it is.
- **Header:** the current chapter line under the title gets a small check button ("Mark done" tooltip; `D` key; palette "Mark chapter as done"). At the end of a chapter, the existing "Next chapter: …" pill becomes a split pill: **"✓ Done & next"** and "Next →".
- **Red highlights:** if the chapter has "Confusing" highlights, the check row shows a small red dot with "2 to clarify" (it doesn't block). This ties the feature to semantic colors.
- **Library:** the card shows "4 of 12 chapters" and the progress bar becomes segmented (one segment per top-level chapter, filled when done). Books without chapters keep the plain percent bar. Sort by Progress uses chapters done when available. When every chapter is done, the card shows "Finished" (and if reading status exists, it's set to Finished).

**Does finishing the last page mark it automatically?** No, by default. It **suggests** instead: reaching the chapter's last page makes the "✓ Done & next" pill stand out. Reasons: people jump around (a `[` / `]` press or a search hit would falsely complete chapters), and for exam study "done" is a deliberate statement. A setting "Mark chapters done when I finish their last page" (off by default, in `user_settings.reader_prefs`) is for people who want it; such marks store `source = 'auto'` so they can be shown with a lighter check.

**Contract:** yes. Today there's nowhere to put it: `reading_state` stores page, offset, zoom, percent and seconds only, and `documents.outline` is the book's outline, not user state.

**Data shape (proposed in ADR 0004 "Chapter progress"):** a new synced table `chapter_progress`:

| Column | Type | Note |
|---|---|---|
| `id` | uuid | **Deterministic** UUIDv5 of `(document_id, chapter_key)`, so two devices marking the same chapter write the same row (same lesson as `reading_state` using the document id; avoids unique-constraint conflicts in sync) |
| `user_id` | uuid | → auth.users, cascade; RLS own rows (4 policies) |
| `document_id` | uuid | composite FK `(user_id, document_id)` → documents, cascade |
| `chapter_key` | text | Stable key: outline path + normalized title (`o:3.1:preliminaries`), or `d:<page>:<title>` for guessed headings |
| `title` | text | Snapshot for display and export |
| `page_start` | int | 0-based, for sorting and export |
| `done_at` | timestamptz null | null = not done. Un-marking sets null (no delete), so last-write-wins per row is clean |
| `source` | text | `'manual'` or `'auto'` (check constraint) |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | as every table |

Unique `(user_id, document_id, chapter_key)`. Add it to the `powersync` publication, the sync stream, `ClientSchema`, `TABLE_NAMES`, the RLS integration test, and "Export everything" (`margin-data.json` gains the table; Markdown frontmatter gets `chapters_done: 4/12`).

If shelves get a reading status as a column (N4), put `documents.reading_status` in the same ADR.

**Alternatives considered**
- `user_settings.reader_prefs` JSON map, no ADR: rejected. It's one blob per user synced last-write-wins as a whole, so marking a chapter on the phone while the laptop saves zoom would drop a mark, and it grows with every book.
- A `reading_state.chapters_done` jsonb column: still a contract change, with the same whole-blob conflict per book.
- Bookmarks with a special comment: misuses the annotation model, and they would export as sticky notes into the PDF.

**Fits the principles:** local-first (the check writes to local SQLite and syncs), never blocks reading, no annotation coordinates involved, exported with the user's data.

**Acceptance criteria**
- [ ] ADR 0004 approved before coding. The migration applies to `margin-dev`. The two-user RLS test covers `chapter_progress`. The sync stream and client schema test pass.
- [ ] Ticking a chapter shows the check in under 50 ms (local write), survives reload, and appears on a second browser context within 2 s.
- [ ] Ticked offline, it syncs after reconnecting. Two devices ticking the same chapter end with one row.
- [ ] Parent / child rules: checking a parent checks its children; all children done shows the parent done; undo reverts the whole step.
- [ ] `D`, the header button, the palette command and "✓ Done & next" all work. The shortcut sheet lists `D`.
- [ ] At the last page of a chapter, the pill suggests "Done & next". Nothing is marked automatically unless the setting is on, and then the row has `source = 'auto'`.
- [ ] The library card shows "N of M chapters" and a segmented bar. Sort by Progress uses it.
- [ ] Guessed headings (no outline) can be checked too.
- [ ] "Export everything" includes the table; Markdown frontmatter shows chapters done.
- [ ] E2E on `two-column-paper` (outline) and `scanned-book` / no-outline fixture; screenshots desktop + phone; axe clean.

### 5.6 Only Margin could do this

1. **Chapter coverage map.** A small grid in the book's notebook: chapters × the five meaning-colors (count per cell) + done checks. "Chapter 6: done, 0 definitions, 3 still confusing." It uses semantic colors + chapter progress, which nobody else has together.
2. **"To clarify" list.** Red (Confusing) highlights become a checklist per book, and you tick them when resolved (a `resolved` tag via N5). Non-AI now; later the place where "Explain" plugs in.
3. **Glossary per book from green highlights.** A sorted list of every Definition highlight, exportable as Markdown or CSV (Anki-ready later). PRODUCT already promises it as a downstream effect of green.
4. **Passage links that land on the rectangle.** Q5 + the all-highlights page: every highlight has a link that opens the PDF on the exact rectangle with a flash. Paste these links into notes or a study-group chat (the other person needs the same book in their own library; no file sharing).
5. **Round-trip annotated PDF.** Export to Acrobat or Zotero, mark up there, re-import, and the colors map back to meanings. Already built; worth one line on the landing page.
6. **"Works on a plane" as a visible promise.** Show "Saved on this device" on first highlight and a one-line offline badge. Local-first at about 6 ms per write is rare among web readers.

## 6. Proposed next prompts

Stubs in the shape of `prompts/P*.md`. Each would get "Read first", evidence rules and a PROGRESS entry when turned into a real prompt.

### Q1 — Find in this book
> Needs: P12 · S · no contract change

**Goal:** Ctrl/Cmd+F in the reader finds text in the book, shows "3 of 17", and moves between hits.

**Build**
1. A find bar in the reader header (`read/[documentId]/reader-client.tsx`) using the existing `PdfViewer` `find`, `findNext`, `findPrev` (see `app/dev/reader/reader-demo.tsx` for the reference UI). Ctrl/Cmd+F opens it (the browser's own find stays reachable with a second press), Enter / Shift+Enter next / previous, Esc closes and clears hits.
2. On phones: a search icon in the header opens the bar full width.
3. Command palette: "Find in book…" opens the bar prefilled with the palette query.
4. Add `Ctrl F` to the `?` sheet. Give the panel's color filter chips accessible names ("Key idea, 2").

**Acceptance criteria**
- [ ] On `two-column-paper`, a known sentence from the manifest is found, the page scrolls to it, and the hit is highlighted. "n of m" is correct.
- [ ] Hits on later pages are found without visiting them first. Typing a new query cancels the old search.
- [ ] Works on the French fixture (accents) and the Arabic fixture (RTL).
- [ ] axe clean with the bar open; screenshots desktop + phone.

**Out of scope:** library-wide full-text search (WP-24), semantic search.

### Q2 — Time left and page numbers
> Needs: P12 · S · no contract change

**Goal:** the library card says "p. 5 of 9 · 56 % · about 12 min left", and the chapter list shows page numbers and time left in the current chapter.

**Build**
1. Library query adds `reading_state.page` and `seconds_read` (additive to `lib/documents`). Card and list rows show page, percent and time left.
2. Pace = seconds read ÷ pages advanced, shown only after 3+ pages and 2+ minutes. Rounded ("about 12 min", "about 2 h").
3. Chapters sidebar: each row shows its first page. The current chapter shows "8 min left".
4. The header chapter line shows "· 8 min left in chapter" on wide screens.

**Acceptance criteria**
- [ ] Unit tests for the pace estimate (no data, few pages, long book).
- [ ] E2E: read a few pages (fake clock), the library shows page and time left. The sidebar shows page numbers that match the palette's chapter list.
- [ ] Nothing shows for a book never opened.

**Out of scope:** reading stats and streaks (WP-32), per-day logs.

### Q3 — Better titles and bookmark names
> Needs: P12 · S · no contract change

**Goal:** books without title metadata get a real title, and bookmarks are named after their chapter.

**Build**
1. At upload, if the PDF has no Title (or it equals the file name), take the largest-font line(s) on page 1 (`derive-outline` helpers) as the title, capped at 120 characters. The file name stays the fallback. Rename still works.
2. Bookmarks list: "Chapter title · p. N", with the bookmark's comment as its name if it has one. Rename inline.
3. Settings: highlight label fields titled with the color swatch and default name.

**Acceptance criteria**
- [ ] `arxiv-2210.13502v1.pdf` appears as "Area-law entanglement from quantum geometry". `annotations.pdf` keeps its metadata title.
- [ ] Bookmarks show the chapter. A renamed bookmark keeps its name after reload and in Markdown export.

**Out of scope:** cover editing, DOI metadata lookup.

### Q4 — Focus mode
> Needs: P12 · S · no contract change

**Goal:** one key hides everything but the page.

**Build**
1. `F` and a header button: Fullscreen API + hide the header, sidebar and panel. Moving the pointer to the top edge (or a tap on phones) shows the header for 2.5 s.
2. Esc leaves. The state is not persisted. Palette entry and `?` sheet line.
3. The desktop idle fade of the top bar (P12 follow-up 5) can share the same mechanism.

**Acceptance criteria**
- [ ] `F` enters and Esc leaves. Highlighting, keys 1–5 and undo still work in focus mode.
- [ ] Screenshots desktop + phone; keyboard-only walkthrough still passes.

**Out of scope:** presentation mode, auto-scroll.

### Q5 — Copy with link
> Needs: P12 · S · no contract change

**Goal:** every copied quote carries a link back to the exact spot.

**Build**
1. `copyCitation` writes `"quote" — Title, p. N` + newline + `<origin>/app/read/<id>#a=<annotationId>` for a saved highlight, or `#p=<page>` for a plain selection. Also write `text/html` with the link.
2. Annotations panel item: "Copy link".
3. A toast "Copied with link".

**Acceptance criteria**
- [ ] E2E: copy, open the link in a new context as the same user, and the highlight flashes.
- [ ] Clipboard contains plain text and HTML variants.

**Out of scope:** public sharing, links for other users.

### C1 — Mark chapter as done
> Needs: ADR 0004 approved · M · **contract change**

**Goal:** tick chapters as done in the reader, and see "4 of 12 chapters" in the library.

**Build**
1. ADR 0004 "Chapter progress" (table `chapter_progress` as in R01 §5.5; optionally `documents.reading_status`). Wait for approval.
2. Drizzle schema + migration + RLS + publication + sync stream + `ClientSchema` + `TABLE_NAMES`, tests. A `chapterProgressRepo` (PowerSync) wired in `services.ts`.
3. Chapters sidebar checks, parent/child rules, header button, `D` key, palette, "✓ Done & next" pill, red "to clarify" dot.
4. Library segmented bar + "N of M chapters" + sort.
5. Setting "Mark chapters done when I finish their last page" (off by default, `reader_prefs`).
6. Export everything + Markdown frontmatter.

**Acceptance criteria:** the list in R01 §5.5.

**Out of scope:** streaks, mastery per chapter (WP-32), AI chapter summaries.

## Appendix A — Competitor AI features (listed only)

- **LiquidText:** AI suite "coming soon" (agents that find passages and bring sources into view).
- **MarginNote 4:** whole-book Q&A, auto-highlight, framework reorganization, cloze practice, AI problem extraction, custom AI models.
- **Highlights:** Siri / Apple Intelligence integration (2026.2).
- **PDF Expert:** AI chat and summaries (from general knowledge; not checked this run).
- **Readwise Reader:** Ghostreader (presets on selections and documents), Global Ghostreader cited answers across the library, auto-highlighting, MCP.
- **Kindle:** book recaps (review sources; not checked this run).
- **Apple Books:** none found in the Books app itself.
- **Zotero 7:** none built in (third-party plugins only).
- **Acrobat Reader:** AI Assistant (paid add-on).
- **RemNote:** AI Cards from highlights, Learn PDF (sections with summary, cards, quiz), AI Tutor with page citations.

## Appendix B — Sources

All read 2026-10-31 through search excerpts (see Decisions 4). **docs** = official help, docs, changelog or vendor site. **review** = third-party.

| App | Source | Type |
|---|---|---|
| LiquidText | https://www.liquidtext.net/features | docs |
| LiquidText | https://www.liquidtext.net/pricing-features | docs |
| LiquidText | https://law.liquidtext.net/ai-suite/ | docs |
| LiquidText | https://apps.apple.com/us/app/liquidtext-pdf-document-reader-annotate-excerpt/id922765270 | docs (store listing) |
| LiquidText | https://www.macworld.com/article/228419/liquidtext-for-ipad-review-all-you-need-for-deep-research-projects.html | review |
| MarginNote 4 | https://www.marginnote.com/en/features/ | docs |
| MarginNote 4 | https://www.marginnote.com/en/whats-new/ | docs |
| MarginNote 4 | https://www.marginnote.com/en/scenarios/research.html | docs |
| MarginNote 4 | https://www.marginnote.com/en/scenarios/medical.html | docs |
| MarginNote 4 | https://forum.marginnote.com/t/ver-4-4-4-4-4-5-unlock-custom-ai-major-upgrades-to-ai-problem-extraction-export-print-markdown-text-box/11984 | docs (vendor forum release note) |
| Highlights | https://highlightsapp.net/ | docs |
| Highlights | https://highlightsapp.net/features/ | docs |
| Highlights | https://highlightsapp.net/faq/ | docs |
| Highlights | https://highlightsapp.net/blog/ | docs |
| Highlights | https://apps.apple.com/us/app/highlights-pdf-reader-notes/id1498912833 | docs (store listing) |
| Highlights | https://talk.macpowerusers.com/t/ipad-pdf-annotation-app-with-markdown-export/24375 | review |
| PDF Expert | https://support.readdle.com/pdfexpert/en_US/reading-pdfs/reading-mode | docs |
| PDF Expert | https://support.readdle.com/pdfexpert/en_US/reading-pdfs/enable-the-two-page-view | docs |
| PDF Expert | https://support.readdle.com/pdfexpert/en_US/reading-pdfs/bookmark-pages | docs |
| PDF Expert | https://support.readdle.com/pdfexpert/en_US/reading-pdfs/read-pdf-text-out-loud | docs |
| PDF Expert | https://support.readdle.com/pdfexpert/en_US/reading-pdfs/view-two-pdfs-side-by-side-on-ipad | docs |
| PDF Expert | https://support.readdle.com/pdfexpert/en_US/reading-pdfs/use-smart-search | docs |
| Readwise Reader | https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes | docs |
| Readwise Reader | https://docs.readwise.io/reader/docs/faqs/text-to-speech | docs |
| Readwise Reader | https://docs.readwise.io/changelog | docs |
| Readwise Reader | https://readwise.io/reader/update-aug2026 | docs |
| Readwise Reader | https://docs.readwise.io/reader/guides/filtering/default-views | docs |
| Readwise Reader | https://docs.readwise.io/reader/docs/faqs/exporting | docs |
| Readwise | https://docs.readwise.io/readwise/docs/exporting-highlights | docs |
| Readwise | https://docs.readwise.io/readwise/docs/exporting-highlights/notion | docs |
| Kindle | https://www.amazon.com/gp/help/customer/display.html?nodeId=TT200NNkr2BE4Jnsy9 | docs |
| Kindle | https://www.amazon.com/b?ie=UTF8&node=17717476011 | docs |
| Kindle | https://www.amazon.com/gp/help/customer/display.html?nodeId=GFBT6Y7AFLJY947N | docs |
| Kindle | https://www.amazon.com/gp/help/customer/display.html?nodeId=G5WYD9SAF7PGXRNA | docs |
| Kindle | https://www.amazon.com/gp/help/customer/display.html?nodeId=T0MT2p2D8t046zUxih | docs |
| Kindle | https://digprjsurvey.amazon.com/csad/help/node/TNtSm13k3txFI4EvDV | docs (Amazon help mirror: PDF notes support by device) |
| Kindle Scribe | https://www.techradar.com/tablets/ereaders/amazons-finally-nailed-scribbling-in-the-margins-with-the-kindle-scribes-new-active-canvas-feature | review |
| Kindle | https://goodereader.com/blog/kindle/kindle-reading-insights-is-an-excellent-system-that-monitors-reading-habits | review |
| Apple Books | https://support.apple.com/guide/iphone/set-reading-goals-iph6013e96f4/ios | docs |
| Apple Books | https://support.apple.com/guide/books/set-reading-goals-ibks7c41beea/mac | docs |
| Apple Books | https://support.apple.com/guide/iphone/annotate-books-iph17bf340c1/ios | docs |
| Apple Books | https://support.apple.com/guide/books/highlight-book-passages-and-add-notes-ibks3975f128/mac | docs |
| Zotero 7 | https://www.zotero.org/blog/zotero-7/ | docs |
| Zotero 7 | https://www.zotero.org/support/7.0_changelog | docs |
| Zotero 7 | https://forums.zotero.org/discussion/106716/available-for-beta-testing-updated-reader-with-epub-snapshot-support-and-new-annotation-types | docs (staff post) |
| Zotero 7 | https://forums.zotero.org/discussion/114348/zotero-7-beta-improvements-to-preview-when-hovering-over-a-link | docs (staff post) |
| Zotero 7 | https://forums.zotero.org/discussion/109665/split-view-with-two-different-pdfs | review (user thread) |
| Acrobat Reader | https://www.adobe.com/acrobat/pdf-reader.html | docs |
| Acrobat Reader | https://helpx.adobe.com/au/reader/desktop/accessibility-features.html | docs |
| Acrobat Reader | https://helpx.adobe.com/acrobat/mobile/view-manage-files/liquid-mode.html | docs |
| Acrobat Reader | https://helpx.adobe.com/acrobat/using/viewing-pdfs-viewing-preferences.html | docs |
| Acrobat Reader | https://helpx.adobe.com/acrobat/desktop/get-started/learn-the-basics/navigation.html | docs |
| RemNote | https://help.remnote.com/en/articles/6690975-learning-from-pdfs-and-files-with-the-remnote-reader | docs |
| RemNote | https://www.remnote.com/feature/annotate-pdf | docs |
| RemNote | https://www.remnote.com/feature/learn-any-pdf | docs |
| (chapter checklists) | https://chapterbychapter.app/ | review (non-PDF app with chapter checks) |
| (chapter checklists) | https://apps.apple.com/us/app/pdf-library-ebook-reader/id6503659712 | review (document-level status only) |

Matrix cells marked ● or ◐ without a matching row above (for example scroll modes, themes and sort, which every app documents) are based on each app's general documentation and are low risk. Cells I was least sure of are ◐ rather than ●.
