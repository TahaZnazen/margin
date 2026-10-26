# P00 — Foundations

> Wave 1 · Needs: nothing · Run: `Execute prompts/P00-foundations.md`

## Read first
`CLAUDE.md` · `prompts/README.md` (Standard rules) · `docs/ARCHITECTURE.md` §2 · `docs/ROADMAP.md` (MVP track)

## Goal
An empty but production-grade monorepo. One command installs, typechecks, lints, tests and builds; CI runs the same checks on every push; the app talks to the user's dev Supabase project (`margin-dev`).

## Build
1. `git init` with `main` as the default branch. `.gitignore` covers: `node_modules`, `.next`, `.turbo`, `.env*` (except `.env.example`), `evidence/`, `playwright-report/`, `test-results/`, and everything in `fixtures/pdfs/` except READMEs, scripts, the manifest and the `generated/` folder. This prompt commits directly to `main`.
2. pnpm workspace + Turborepo. Root scripts: `dev`, `build`, `typecheck`, `lint`, `format`, `test`, `test:integration`, `e2e`. Pin Node LTS (`.nvmrc` + `engines`) and pnpm (`packageManager`).
3. Shared TypeScript config (`strict`, `noUncheckedIndexedAccess`), a Biome config, and a Vitest workspace with two projects:
   - **unit** (`pnpm test`): no network, no secrets, runs anywhere
   - **integration** (`pnpm test:integration`): files named `*.int.test.ts`, run against the dev Supabase project. Add one now: the Supabase Auth health check.
4. `apps/web`: latest stable Next.js (App Router, `src/`, TypeScript, Tailwind v4, `@/*` alias). The home page shows "Margin" and a server-side health check that makes a lightweight call to Supabase (e.g. the Auth health endpoint) and renders OK or FAIL.
5. Empty packages, each with `package.json`, `src/index.ts` and test setup: `@margin/db`, `@margin/annotation-model`, `@margin/reader`, `@margin/sync`, `@margin/ui`. Don't create `ai`, `srs` or `ingest` yet.
6. Supabase clients with `@supabase/supabase-js` + `@supabase/ssr`: browser, server, and a secret-key admin client that is server-only (guarded by the `server-only` package). Env validation with zod in `apps/web/src/env.ts`. `.env.example` lists every variable, with a comment saying where to find it in the Supabase dashboard. Use Supabase's current key names (publishable / secret). `.env.local` points at the dev project; production values only ever live in Vercel (P12).
7. `apps/web/src/config/flags.ts` with `ai: false` and `billing: false`.
8. Playwright in `apps/web/e2e`, with one smoke test: the home page renders and health is OK.
9. GitHub Actions: on every push and PR, install (cached), typecheck, lint, unit tests and build. A second job, **integration**, runs `pnpm test:integration` against the dev project using repository secrets; if a secret is missing it fails with a clear message, never skips. Add an E2E job that runs only on manual trigger.
10. If `gh auth status` succeeds, create a **private** GitHub repo named `margin` and push. Then, once the user agrees, set the repository secrets the integration job needs from `apps/web/.env.local` without printing their values (e.g. `gh secret set -f`). If `gh` isn't available, skip this step and say so.
11. Fill the "Commands" section of `CLAUDE.md`. Add the first entry to `docs/PROGRESS.md`.

If `apps/web/.env.local` is missing, create it from `.env.example`, then stop and ask the user to fill it in.

## Acceptance criteria
- [ ] A fresh clone passes `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` on Windows; `pnpm test` needs no network and no `.env.local`.
- [ ] `pnpm test:integration` passes against the dev project, locally and in CI (if the repo was created).
- [ ] `pnpm dev` → http://localhost:3000 shows health **OK** against the user's dev Supabase project.
- [ ] `pnpm e2e` passes.
- [ ] CI is green on GitHub (if the repo was created).
- [ ] Importing the admin client from a client component fails the build.

## Out of scope
Database tables, auth UI, any product feature, Vercel deployment.
