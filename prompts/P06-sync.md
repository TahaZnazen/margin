# P06 — Sync foundation (local-first data layer)

> Wave 4 · Needs: P02, P05 · Parallel with: P07 · Run: `Execute prompts/P06-sync.md`

## Read first
`CLAUDE.md` (principle 1) · `prompts/README.md` · `docs/ARCHITECTURE.md` §3, §5.3 · `packages/sync/powersync.yaml` · `docs/PROGRESS.md`

## Goal
All reads come from local SQLite. Every write lands locally in under 50 ms and syncs in the background, including while offline.

## Build
1. **Connect PowerSync Cloud (Free) to the dev Supabase project (`margin-dev`).** P12 connects a second instance to production. Write numbered steps in PROGRESS for anything the user must click in a dashboard (create the instance, connect the database, set up Supabase JWT auth), then do everything else via code or CLI. Deploy the sync config from P02.
2. **`packages/sync`:** PowerSync web SDK + its React integration.
   - `SyncProvider` opens the local DB after sign-in and closes and **clears** it on sign-out.
   - The connector's `fetchCredentials` uses the Supabase session; `uploadData` applies the CRUD batch through supabase-js.
   - Error policy: **transient** errors (network, 5xx) retry with backoff. **Permanent** errors (constraint or RLS violation) are logged into a local-only `sync_errors` table and the operation is dropped, so the queue never blocks.
   - Use the SDK's multi-tab support.
3. **Typed repositories**, the only way app code touches data: `documentsRepo`, `readingStateRepo`, `annotationsRepo`, `notesRepo`, `collectionsRepo`, `settingsRepo`.
   - Reads are live-query hooks (`useDocuments()`, `useAnnotations(documentId)`, …) that exclude soft-deleted rows.
   - Writes generate UUIDv7 ids, set `user_id`, soft-delete through `deleted_at`, and validate JSON columns with the `annotation-model` zod schemas.
4. Move `settingsRepo` from P05 onto PowerSync; the UI stays unchanged.
5. **Sync status indicator** in the top bar: synced, syncing, offline, or errors (a popover lists `sync_errors`).
6. Unit tests for the repositories; E2E with two browser contexts signed in as the same user.

## Acceptance criteria
- [ ] A write is visible in the same tab in < 50 ms (performance mark in a test).
- [ ] Two contexts: a change in A appears in B in < 2 s.
- [ ] Offline: create 50 annotation rows with the network off, reload while still offline (data still there), reconnect. All 50 reach Postgres and context B.
- [ ] Chaos: close the tab right after a write; the write syncs after reopening.
- [ ] A row that violates a constraint lands in `sync_errors` and doesn't block later writes.
- [ ] Sign-out clears local data; signing in as another user shows none of the previous user's data.

## Out of scope
Upload, reader, any feature UI beyond the sync indicator.
