# P01 — Golden PDF corpus

> Wave 2 · Needs: P00 · Parallel with: P02, P03 · Run: `Execute prompts/P01-corpus.md`

## Read first
`CLAUDE.md` · `prompts/README.md` · `docs/ROADMAP.md` (WP-04)

## Goal
A repeatable set of test PDFs covering the hard real-world cases, so every later prompt can prove its work on them.

## Build
1. `fixtures/pdfs/manifest.json`. One entry per file: id, file name, source URL, license, sha256, size, what it tests, and **expected facts**: page count, has an outline, has a text layer, and at least one known sentence with its page and approximate position. Later tests rely on these facts.
2. `fixtures/pdfs/fetch.mjs` (cross-platform Node): downloads missing files and verifies their sha256. `pnpm fixtures` runs it. Downloaded PDFs are git-ignored and treated as untrusted data: store them, never execute anything from them.
3. `fixtures/pdfs/generate.mjs` uses pdf-lib (dev dependency) to synthesize edge cases into `fixtures/pdfs/generated/`:
   - **"ruler" PDF:** text drawn at exact, documented coordinates. It's the pixel-accuracy reference for the reader and annotations.
   - Mixed page sizes plus rotated pages (90°, 180°, 270°), with a non-zero CropBox offset on one page.
   - Existing `/Highlight` and `/Text` annotations with known QuadPoints, colors and contents (the import test).
   - A corrupted (truncated) file.
   Commit generated files only if each is under 200 KB.
4. Cover these cases from license-safe sources (OpenStax CC-BY textbooks, arXiv CC-BY papers, Internet Archive / Project Gutenberg public-domain scans, Wikimedia Commons):
   - a 600+ page textbook with an outline
   - a scanned book without a text layer
   - a two-column paper with equations
   - slides exported to PDF
   - an Arabic (RTL) document
   - a French document with accents and ligatures
   - a large image-heavy PDF (≥ 100 MB), for local performance tests only, never uploaded
   - a 40–50 MB PDF (just under the storage cap) and a 51+ MB PDF (just over it)
   - a password-protected PDF (record the password in the manifest)
   - a PDF containing JavaScript and form fields (security)
   If a case can't be sourced with a clear license, generate it. If neither works, record the gap in the manifest.
5. `fixtures/pdfs/private/` (git-ignored) with a README telling the user to drop their own PDFs there. Tests pick them up when present, with smoke-level checks only (open, render, select).
6. `fixtures/pdfs/README.md`: a table summarizing every case.
7. `fixtures/index.ts`: typed access to the manifest and file paths for tests in any package.

## Acceptance criteria
- [ ] On a clean checkout, `pnpm fixtures` downloads and verifies everything; re-running it does nothing.
- [ ] Every manifest entry has a license, a source and expected facts; the ruler PDF's coordinates are documented.
- [ ] No PDF over 200 KB is committed to git.
- [ ] `fixtures/index.ts` is importable from a Vitest test in another package.

## Out of scope
Any viewer or app code.
