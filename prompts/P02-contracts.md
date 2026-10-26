# P02 — Contracts: schema, RLS, annotation model, sync config

> Wave 2 · Needs: P00 · Parallel with: P01, P03 · Run: `Execute prompts/P02-contracts.md`

## Read first
`CLAUDE.md` · `prompts/README.md` · `docs/ARCHITECTURE.md` §3, §4, §8 · `docs/PROGRESS.md`

## Goal
Freeze the contracts every later prompt builds on: the database schema with row-level security, the annotation model, and the sync configuration. After this prompt they change only through an ADR.

## Build

### 1. `packages/db`: Drizzle schema + migrations
Use Drizzle's RLS support (`pgPolicy` + Supabase helpers). Generate SQL migrations and commit them; `pnpm db:generate` creates new ones and `pnpm db:migrate` applies them to the project in `apps/web/.env.local` (the dev project, `margin-dev`; P12 applies them to production). Add `pnpm db:migrate` to the CI integration job, before `pnpm test:integration`.

Every table has: `id uuid` primary key (generated on the client as UUIDv7; a `gen_random_uuid()` default is fine for server inserts), `user_id uuid not null` → `auth.users` on delete cascade, `created_at`, `updated_at` (maintained by a trigger), `deleted_at`.

| Table | Columns |
|---|---|
| `documents` | title text not null · author text · sha256 text not null · byte_size bigint · page_count int · storage_path text · cover_path text · has_text_layer boolean · language text · outline jsonb · read_status text check (`uploading`, `readable`, `failed`) default `uploading` · ai_status text check (`none`, `pending`, `processing`, `ready`, `failed`) default `none` · annotations_imported_at timestamptz · last_opened_at timestamptz · unique (user_id, sha256) where deleted_at is null |
| `reading_state` | document_id (unique per user) · page int · offset_pt real · zoom real · percent real · seconds_read int default 0 |
| `annotations` | document_id · kind check (`highlight`, `area`, `bookmark`, `ink`) · color check (`key`, `definition`, `example`, `memorize`, `confusing`) · target jsonb not null · page_start int not null · quote_text text · comment text · snapshot_path text · tags jsonb default `[]` · anchor_status check (`anchored`, `reanchored`, `orphaned`) default `anchored` · index (user_id, document_id, page_start) · checks per ARCHITECTURE §4 "Target by kind": a `highlight` has a `color` and a `quote_text`; a `bookmark` has no `color` |
| `notes` | document_id (nullable = standalone note) · title text · doc_json jsonb · plain_text text |
| `collections` | name text not null · sort_order int |
| `collection_documents` | collection_id · document_id · unique (collection_id, document_id) |
| `user_settings` | one row per user · theme check (`light`, `sepia`, `dark`, `system`) · highlight_labels jsonb · reader_prefs jsonb |

- **RLS on every table:** select, insert, update and delete only where `user_id = auth.uid()` (insert and update use `with check` too).
- **Storage:** a custom SQL migration creates a private bucket `documents` whose policies let a user read and write only paths starting with `{auth.uid()}/`.
- **PowerSync prerequisites** from PowerSync's Supabase guide (publication etc.). If it needs a database role with a password, create it with a one-off script that reads the password from env. Never put it in a committed migration.

### 2. `packages/annotation-model` (pure TypeScript; zod is its only dependency for now; P09 adds approx-string-match for re-anchoring)
- zod schemas + types for `AnnotationTarget` exactly as in ARCHITECTURE §4 (the `segments` form), with **one target schema per kind** and a row-level schema discriminated on `kind`, so `{kind, color, target, quote_text}` validate together ("Target by kind"). `Rect` = `[x1, y1, x2, y2]` in PDF points (CropBox-relative, unrotated, top-left origin), `Quote`, `HighlightColor` (5 keys + default labels: Key idea, Definition, Example, Memorize, Confusing), `AnnotationKind`.
- `pageToViewport(rect, view)` / `viewportToPage(rect, view)`, where `view = { pageWidth, pageHeight, rotation, scale }`.
- `mergeLineRects(rects)`: merges per-character boxes into one rect per line.
- `buildQuote(pageText, start, end)`: exact text + 32-character prefix and suffix.
- Property tests (fast-check, dev dependency): round-trip within 0.5 pt for all 4 rotations × zoom 0.5 / 1 / 2 / 3; merging never shrinks the covered area.
- Unit tests for the per-kind schemas: each accepts a valid example and rejects the shapes the §4 table rules out (a highlight without a quote, an area with two rects, a bookmark with a quote or a color, any `ink` target).

### 3. `packages/sync`: sync contract
- The PowerSync client schema mirroring all the tables above.
- The sync configuration scoping every table to the signed-in user, using PowerSync's current recommended mechanism (Sync Streams if generally available, otherwise sync rules). Commit it as `packages/sync/powersync.yaml` with deployment steps. P06 connects the instance, so stop at "ready to deploy".

### 4. ADRs
Short ADRs (context, decision, consequences): `docs/adr/0001-annotation-model.md` (including the per-kind target rules) and `docs/adr/0002-local-first-sync.md`, based on ARCHITECTURE §4 and §11.

### 5. Two-user security test (Vitest integration test, against the dev project)
Name it `*.int.test.ts` so it runs in `pnpm test:integration` and in the CI integration job, not in `pnpm test`. Create two users with the admin client and clean them up afterwards. Check that user B reads 0 of user A's rows in every table, can't insert a row carrying A's `user_id`, and can't read A's storage objects.

## Acceptance criteria
- [ ] Migrations apply cleanly; re-running them is a no-op.
- [ ] The two-user test passes for every table and for storage, locally and in the CI integration job.
- [ ] `annotation-model` has 100% branch coverage on transforms, and the property tests pass.
- [ ] Each kind's target schema accepts valid examples and rejects invalid ones; the DB rejects a highlight without a color or quote.
- [ ] The sync config passes PowerSync's validation (CLI or dashboard), or the exact validation steps are documented for P06.
- [ ] `@margin/db` and `@margin/annotation-model` types compile when imported in `apps/web`.

## Out of scope
Tables for AI, cards or billing (they arrive with their phases). Any UI.
