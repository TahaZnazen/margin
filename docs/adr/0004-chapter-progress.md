# ADR 0004 — Chapter progress and reading status

Status: Accepted by the orchestrator on the founder's request, 2026-10-31 · Contract (ARCHITECTURE §3, §8)

## Context

Run 3, feature C1 (docs/research/R01-competitor-gaps.md §5.5): readers want to tick a chapter as done and see "4 of 12 chapters" in the library. For exam study, "done with chapter 7" is the real unit of progress. Today there is nowhere to store it: `reading_state` holds page, offset, zoom, percent and seconds only, and `documents.outline` is the book's outline, not user state. The shelves feature (N4) also wants a per-book reading status (to read / reading / finished).

## Decision

1. **A new synced table `chapter_progress`**, one row per (document, chapter):

   | Column | Type | Note |
   |---|---|---|
   | `id` | uuid | Deterministic UUIDv5 of `(document_id, chapter_key)` |
   | `user_id` | uuid | → auth.users, on delete cascade; RLS own rows (4 policies) |
   | `document_id` | uuid | composite FK `(user_id, document_id)` → `documents(user_id, id)`, on delete cascade |
   | `chapter_key` | text | `o:<outline path>:<normalized title>` (e.g. `o:3.1:preliminaries`), or `d:<page>:<title>` for guessed headings |
   | `title` | text | snapshot for display and export |
   | `page_start` | integer | 0-based, for sorting and export |
   | `done_at` | timestamptz null | null = not done. Un-marking sets null; the row is not deleted, so last-write-wins per row is clean |
   | `source` | text | `'manual'` or `'auto'`, check constraint; default `'manual'` |
   | `created_at`, `updated_at`, `deleted_at` | timestamptz | as every table |

   Unique `(user_id, document_id, chapter_key)`.
2. **Deterministic id.** The id is the UUIDv5 (RFC 9562, SHA-1) of the name `"<document_id>:<chapter_key>"`, using the existing `uuidv5` in `apps/web/src/lib/uuid.ts` (already used for shelves) and a fixed namespace constant defined next to the repository code in phase 2. Two devices that mark the same chapter offline write the same row id, so the second upload is an update, not a unique-key violation (the rule from ADR 0002 consequences). The unique key remains as a guard.
3. **`documents.reading_status`**: nullable text, check `in ('to_read', 'reading', 'finished')`; null = not set. No default and no backfill: existing rows are untouched.
4. **Replication:** the table is added to the `powersync` publication by `ALTER PUBLICATION powersync ADD TABLE`, to the stream in `packages/sync/powersync.yaml`, and to the client `AppSchema` (with the new `documents.reading_status` column), `TABLE_NAMES`, the two-user RLS test and the migration test. The drift test in `packages/sync` reads the later `ALTER PUBLICATION` line as well as migration 0003.
5. **Migration 0004 is strictly additive:** it creates a table, adds a nullable column and its check, adds policies, a trigger, grants and a publication entry. It updates, deletes or rewrites no existing row and drops or alters no existing column, constraint or policy. The database is shared with real data, so a unit test checks this.

## Alternatives considered

- **`user_settings.reader_prefs` JSON map (no ADR):** rejected. One blob per user, synced last-write-wins as a whole, so marking a chapter on the phone while the laptop saves zoom would drop a mark, and it grows with every book.
- **`reading_state.chapters_done` jsonb:** still a contract change, with the same whole-blob conflict per book.
- **Bookmarks with a special comment:** misuses the annotation model, and they would export as sticky notes into the PDF.
- **Random UUIDv7 ids plus the unique key:** two offline devices would collide on the unique key at upload and need connector special-casing. A deterministic id avoids it.

## Consequences

- Marks are local-first: the check writes to local SQLite and syncs in the background; reading never waits.
- Un-marking never deletes, so tombstones are only needed if a whole book is removed (the cascade handles that).
- "Export everything" (`margin-data.json`) gains the table; Markdown frontmatter gets `chapters_done: 4/12` (phase 2).
- Chapter keys depend on outline path plus title; if a book's outline is re-extracted and a title changes, the old mark stays under the old key (orphaned, harmless) and the chapter shows as not done.
- **Founder's manual step:** deploy the updated `packages/sync/powersync.yaml` in the PowerSync dashboard (no admin token is available to agents). Until then, marks upload to Postgres but do not sync down to other devices (the new table is not in the deployed stream), and clients on the old stream do not see `documents.reading_status`.
- PowerSync replicates as `powersync_role`, whose SELECT grants come from the one-off `pnpm db:powersync-role` script, not from migrations. Migration 0004 therefore ends with a guarded `DO` block that grants `powersync_role` SELECT on `chapter_progress` if the role exists (it does not re-key the role).
- The Phase 3 "chapter coverage" and "mastery per chapter" (WP-32) features build on this table without further schema change.
