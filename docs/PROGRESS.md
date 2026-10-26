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
