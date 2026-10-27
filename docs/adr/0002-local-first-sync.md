# ADR 0002 — Local-first sync with PowerSync + Supabase

Status: Accepted · 2026-10-26 · Contract (ARCHITECTURE §1, §3, §8)

## Context

A highlight must be visible and persisted locally in under 50 ms, and no user action may wait on the network (principle 1). Users read on several devices and offline. The data is per user, with no sharing in the MVP. Options considered (ARCHITECTURE §2): PowerSync, Zero, Electric, and a hand-rolled outbox.

## Decision

1. **PowerSync + Supabase Postgres.** The client reads and writes a local SQLite database (PowerSync web SDK, P06). PowerSync replicates Postgres to clients through logical replication. Local writes go to an upload queue that a connector applies through supabase-js. In the MVP that's straight to the tables, so RLS and the DB constraints are the validation (prompts/README "MVP simplifications"). From the beta on, uploads go through a zod-validated API.
2. **Sync Streams** (GA; Sync Rules are deprecated): one auto-subscribed stream, `user_data`, with one query per table, `SELECT * FROM <table> WHERE user_id = auth.user_id()` (`packages/sync/powersync.yaml`). That gives one bucket per user. The stream mirrors RLS (`user_id = auth.uid()`), and the CI two-user test proves RLS (ARCHITECTURE §8).
3. **Replication scope.** The `powersync` publication lists the synced tables explicitly rather than `FOR ALL TABLES`, so later server-only tables (chunks, AI, billing) never replicate by accident. PowerSync connects as `powersync_role` (REPLICATION, BYPASSRLS, SELECT on published tables only). The role is created by a one-off script that reads its password from the environment, never in a committed migration.
4. **Row conventions on every synced table:** a client-generated UUIDv7 `id` (rows are created offline); `user_id` → `auth.users` on delete cascade; `created_at`; `updated_at`, which a trigger sets on every server-side update; and `deleted_at` for soft deletes, because other devices need tombstones. Soft-deleted rows sync, and clients filter them out. Child rows reference parents through `(user_id, parent_id)` composite foreign keys, so a row can't point at another user's document even though FK checks bypass RLS.
5. **Conflicts:** last writer wins per row. The server's `updated_at` records when the last write landed. Single-user concurrent edits are rare. If multi-device note editing becomes a real complaint, notes move to Yjs. Review logs (Phase 2) are append-only, and FSRS state is a replay of them, so they merge without conflicts.
6. **The client schema** (`packages/sync/src/schema.ts`) mirrors every Postgres column using PowerSync's type mapping: uuid, text, timestamptz and jsonb become text; integer, bigint and boolean become integer; real stays real. A unit test fails if it drifts from the Drizzle schema, the stream config or the publication.

## Consequences

- Reads are local and instant; writes survive offline and reload. Sync lag doesn't block the UI.
- The tables with one row per scope (`reading_state` per document, `user_settings` per user) have unique keys. Two devices that both create one offline get a unique violation on the second upload. P06's connector must upsert on those keys (or derive the row id deterministically). That's an implementation rule, not a schema change.
- Any new synced table needs four things together: a migration (with RLS), the publication, the stream query and the client schema. The drift test enforces this. A new phase adds its tables through one phase ADR (CLAUDE.md, "Contracts").
- PowerSync and Supabase Free projects pause when inactive (prompts/README); restoring them is manual.
