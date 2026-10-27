# Build progress

Each prompt in `prompts/` appends an entry here when it finishes, newest last. Later prompts read this file to learn what already exists.

<!-- Entry template
## PNN — Title · YYYY-MM-DD · branch pNN-slug
**Built:** …
**Key files:** …
**Commands:** …
**Deviations from the prompt or docs:** …
**Follow-ups:** …
-->

## P00 — Foundations · 2026-10-26 · main
**Built:** pnpm 11 + Turborepo 2 monorepo on Node 24 LTS. TypeScript 5.9 strict (`noUncheckedIndexedAccess`) from `tsconfig.base.json`; Biome 2.6 for lint and format; Vitest 5 with two projects, `unit` (blocks `fetch`, so no network) and `integration` (`*.int.test.ts` against `margin-dev`). `apps/web` is Next.js 16.4 (App Router, `src/`, Tailwind v4, `@/*`) with Cache Components on. The home page streams a request-time Supabase Auth health check (OK / FAIL). Five empty packages (`@margin/db`, `annotation-model`, `reader`, `sync`, `ui`) each have a smoke test. There are browser, server and secret-key admin Supabase clients, zod env validation, feature flags (`ai`, `billing` off), a Playwright smoke test, and GitHub Actions (checks + server-only guard + integration on every push and PR, E2E on manual trigger).
**Key files:** `package.json`, `pnpm-workspace.yaml` (version catalog), `turbo.json`, `biome.json`, `vitest.config.ts`, `test/setup.{unit,integration}.ts`, `apps/web/src/env.ts`, `apps/web/src/lib/supabase/{client,server,admin}.ts`, `apps/web/src/server/health.ts`, `apps/web/src/config/flags.ts`, `apps/web/scripts/check-server-only.mjs`, `apps/web/e2e/smoke.spec.ts`, `.github/workflows/{ci,e2e}.yml`, `.github/actions/{setup,require-secrets}`.
**Commands:** see "Commands" in `CLAUDE.md`.
**Deviations from the prompt or docs:**
- TypeScript 5.9, not the newer 7.x: Next.js 16.4 still scaffolds `typescript@^5`.
- Env vars are validated when `publicEnv()` / `serverEnv()` is called, not at import, so `pnpm build` and `pnpm test` work on a fresh clone without `.env.local`.
- The integration test also checks that the secret key works (`auth.admin.listUsers`), so the CI secrets needed from P02 on are proven now.
- Biome's Markdown formatter is off, so the planning docs stay as written.
- `next.config.ts` refuses to build if any `NEXT_PUBLIC_*` value is an `sb_secret_` key; `distDir` can be overridden via `NEXT_DIST_DIR` (used only by the server-only probe).
- No Supabase session-refresh `proxy.ts` yet: it belongs with auth (P05).
- No fonts loaded (system stack) until the design system (P03).
**Follow-ups:**
- P02: add `DATABASE_URL` (and any PowerSync role password) to `.env.example`, the integration setup and CI secrets; wire `@margin/*` packages into `apps/web` (Next may need `transpilePackages` for TS-source packages).
- P05: add `src/proxy.ts` with `updateSession` from Supabase's SSR guide.
- P12: add a guard so integration/E2E refuse to run against the production project.
- Optional: pnpm 12 is out; upgrade `packageManager` in its own change.

## P02 — Contracts: schema, RLS, annotation model, sync config · 2026-10-27 · branch p02-contracts
**Built:** Drizzle schema for 7 tables (`documents`, `reading_state`, `annotations`, `notes`, `collections`, `collection_documents`, `user_settings`) with RLS (4 policies each, 28 total), `updated_at` trigger, explicit grants, a private `documents` storage bucket with per-user folder policies, and the `powersync` publication. `@margin/annotation-model` has per-kind target schemas, a row schema discriminated on `kind`, page/viewport transforms, `mergeLineRects` and `buildQuote`, with fast-check property tests (100% coverage on the package's source). `@margin/sync` has the PowerSync client schema and `powersync.yaml` (Sync Streams) with deploy steps in its README. ADRs 0001 and 0002. Two-user RLS/storage integration test and a migration re-run test. `@margin/*` wired into `apps/web`; CI runs `pnpm db:migrate` before integration.
**Key files:** `packages/db/src/{schema,connection}.ts`, `packages/db/migrations/0000..0003`, `packages/db/scripts/powersync-role.ts`, `packages/db/src/{rls,migrations}.int.test.ts`, `packages/annotation-model/src/*`, `packages/sync/{powersync.yaml,README.md,src/schema.ts}`, `docs/adr/000{1,2}-*.md`.
**Commands:** `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:powersync-role` (one-off, needs `POWERSYNC_DB_PASSWORD`).
**New env vars / CI secrets:** `DATABASE_URL` (margin-dev session pooler, port 5432), `DATABASE_CA_CERT` (Supabase root CA, PEM text or file path; TLS verification is never disabled), `POWERSYNC_DB_PASSWORD` (local only). GitHub secrets: `DATABASE_URL`, `DATABASE_CA_CERT`.
**Deviations from the prompt or docs:** Direct Postgres connections use `pg` with `rejectUnauthorized: true` and an explicit CA, because Supabase's certificate chains to its own CA (not in Node's trust store).
**Follow-ups:**
- P06 connects the PowerSync instance (steps in `packages/sync/README.md`) and validates `powersync.yaml`.
- Run `pnpm db:migrate` and `pnpm test:integration` once `DATABASE_CA_CERT` is set (not verified in the session that wrote this entry).

## P01 — Golden PDF corpus (lean) · 2026-10-27 · branch p01-corpus
**Built:** `@margin/fixtures` workspace package (`fixtures/`): `pdfs/manifest.json` (15 entries: id, file, source, license, sha256, size, what it tests, expected facts incl. known sentences with page and rect), `pdfs/fetch.mjs` (`pnpm fixtures`: downloads missing files, verifies sha256 and size, rebuilds missing generated files, idempotent), `pdfs/generate.mjs` (pdf-lib, deterministic), `index.ts` (zod-validated typed manifest, `fixturePath(id)`, `privatePdfPaths()`), READMEs. Committed generated PDFs (all < 200 KB): `ruler`, `mixed-pages` (sizes, 90/180/270 rotations, CropBox offset), `annotations` (/Highlight + /Text), `javascript-forms`, `encrypted` (password in manifest), `corrupted-truncated`. Downloaded (git-ignored, 12 MB total): `two-column-paper` (arXiv CC-BY), `scanned-book` (public domain, no text layer), `slides`, `arabic-rtl`, `french-accents-ligatures`. Test in `packages/reader/src/fixtures.test.ts` imports `@margin/fixtures`.
**Commands:** `pnpm fixtures`, `pnpm --filter @margin/fixtures generate`.
**Deviations:** Lean MVP: `textbook-economics` (974 pages, 51.8 MB), `image-heavy-astronomy` (161 MB), `size-under-cap` and `size-over-cap` are in the manifest with `"status": "skipped (lean MVP)"` and are not fetched. So there is no 600+ page textbook, ≥100 MB, or 40-50/51+ MB case in the default run; remove the status to enable them. Do not run `generate.mjs` without checking the skipped statuses survive (it rewrites generated entries).
**Follow-ups:** enable the skipped entries before upload-limit and large-document performance work (P-series for storage/perf).
