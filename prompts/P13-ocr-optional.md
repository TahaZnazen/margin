# P13 — OCR for scanned PDFs (optional)

> Any time after P08 · Needs: a Modal account (check its current free credits) · Run: `Execute prompts/P13-ocr-optional.md`

## Read first
`CLAUDE.md` (Licenses) · `prompts/README.md` · `docs/ARCHITECTURE.md` §2 (OCR row), §5.2 · `docs/PROGRESS.md`

## Goal
Scanned books, which have no text layer, become highlightable and searchable.

## Build
1. **`apps/ingest`** (Python, managed with uv): a Modal function `ocr_document(document_id)` that:
   1. downloads the PDF with the Supabase secret key
   2. runs OCRmyPDF in skip-text mode, with languages configurable (default `eng+fra+ara`)
   3. verifies **every page's size and rotation are unchanged**, and aborts otherwise
   4. uploads the result as `source.ocr.pdf`
   5. updates the document (`storage_path`, `sha256` → the new hash, `has_text_layer = true`) and rewrites existing annotations' fingerprints to the new hash. This is safe because page geometry is unchanged.
2. **Licensing check first:** OCRmyPDF may require Ghostscript (AGPL) depending on version and options. Find out whether the chosen setup can run without it. If it can't, that's acceptable for **personal use only**: record it in PROGRESS as a blocker to resolve before any beta.
3. A Modal web endpoint protected by a shared secret, called from `POST /api/documents/[id]/ocr` in `apps/web`, with its zod schemas in `apps/web/src/server/contracts/documents.ts`.
4. **UI:** for a document without a text layer, the reader shows a banner: "This PDF is scanned. Make it highlightable?" It runs OCR, shows progress (the document state arrives through sync), then swaps in the new file and replaces the OPFS cache.
5. If the OCR output exceeds the 50 MB storage cap, warn and keep the original.

## Acceptance criteria
- [ ] The scanned corpus file becomes selectable and findable; an area annotation made before OCR stays in place afterwards.
- [ ] The endpoint rejects calls without the secret.
- [ ] Every Python dependency's license is recorded; any AGPL component is flagged in PROGRESS.
- [ ] The Modal cost of OCR for one 300-page book is measured and recorded.

## Out of scope
Docling, chunking, embeddings (Phase 2).
