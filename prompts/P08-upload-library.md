# P08 — Upload, library & reading flow

> Wave 5 · Needs: P06, P07 · Run: `Execute prompts/P08-upload-library.md`

## Read first
`CLAUDE.md` (principle 2) · `prompts/README.md` (MVP simplifications) · `docs/ARCHITECTURE.md` §5.1, §8 · `docs/PRODUCT.md` (Read row) · `docs/PROGRESS.md`

## Goal
Drop a PDF anywhere and it's in the library and readable within seconds. Any book opens where you left off, on any device.

## Build
1. **Storage layer** in `apps/web/src/lib/storage/`: a `StorageProvider` interface (`createUpload`, `getReadUrl`, `remove`) with a Supabase Storage implementation. Resumable uploads use Uppy + its Tus plugin against Supabase's resumable endpoint; read URLs are signed for ≤ 10 minutes. Paths: `{userId}/{documentId}/source.pdf` and `cover.webp`. R2 will be a second implementation later.
2. **Upload flow:** drag-and-drop anywhere in `/app`, a file picker, several files at once.
   1. In a Web Worker, compute an incremental SHA-256 (hash-wasm). If the user already has that hash, open the existing book and show a toast.
   2. Otherwise create the document row locally (`read_status: uploading`) and write the file to OPFS (`documents/{id}.pdf`).
   3. Extract title, author, page count, outline and the text-layer flag with the engine (fallback title: the file name). Render page 1 to `cover.webp`.
   4. Upload the file and the cover, then call `POST /api/documents/[id]/complete`. The server checks the object exists, reads its first bytes (`%PDF-`), checks the size, and sets `readable`, or `failed` with a reason. Its request and response zod schemas live in `apps/web/src/server/contracts/documents.ts`, the first API contract.
   5. Show progress, retry and cancel per file.
   The book opens **immediately** from OPFS while the upload is still running.
3. **Limits:** files over 50 MB are rejected before upload with a clear message (the Supabase Free cap; make the limit a config value). Non-PDF files are rejected.
4. **Library** (`/app`):
   - grid and list views showing cover, title, author, progress bar (`reading_state.percent`) and last opened
   - sort by recent, title or progress; search title and author with a local query
   - collections: create, rename, delete, add or remove a book, filter by collection
   - book menu: rename, edit author, delete with an undo toast (soft delete, then remove from storage after the undo window)
   - an empty state that invites dropping a first PDF; skeletons while loading
5. **Reading route** `/app/read/[documentId]`: loads from OPFS when present, otherwise downloads through a signed URL (with progress) and caches it in OPFS. It restores the position from `reading_state` and saves it on change. It updates `last_opened_at`, and updates `seconds_read` only while the tab is visible and the user is active.
6. **Cross-device:** on device B the book downloads and opens at the position saved on device A.
7. **E2E:** upload two corpus PDFs; duplicate detection; open → read → close → reopen at the same position; a second browser context (the "other device") restores the position; delete → undo.

## Acceptance criteria
- [ ] After upload the book appears in the library instantly and is readable < 3 s after the bytes land (measured).
- [ ] A network drop mid-upload resumes (tested by going offline in Playwright).
- [ ] A duplicate PDF opens the existing book, with no second upload.
- [ ] The position is restored within ±1 line across "devices".
- [ ] With 200 books (seed script), the library is interactive in < 1 s.
- [ ] Corrupted, non-PDF and over-50-MB files are rejected with clear messages.

## Out of scope
Highlights (P09), offline toggle and PWA (P12), OCR (P13).
