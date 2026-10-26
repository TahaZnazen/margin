# Margin (codename) — agent operating manual

Margin is a web app where people upload PDFs, read them, highlight, take notes, and turn what they read into long-term memory: AI explanations grounded in the book, and spaced-repetition review that always links back to the exact passage.

Before any task, read:
- `docs/PRODUCT.md` — what we build, for whom, and why it wins
- `docs/ARCHITECTURE.md` — stack, data model, contracts, budgets
- `docs/ROADMAP.md` — your work package (WP-xx), its dependencies and acceptance criteria
- `prompts/README.md` — build order and standard rules, when you're executing a prompt from `prompts/`
- `docs/PROGRESS.md` — what earlier prompts already built

## Non-negotiable principles

1. **Never lose a highlight.** User writes go to local SQLite first (< 50 ms) and sync in the background. No user action waits on the network.
2. **Never block reading on processing.** A PDF is readable the moment its bytes land. OCR, structure, chunking and embeddings only power AI and search.
3. **The data model is ours; the engine is a plugin.** Annotations are stored in PDF page coordinates plus a text quote (W3C Web Annotation shape), never in viewer pixels or a library's private format. All engine access goes through `ReaderEngine` in `packages/reader`.
4. **AI is grounded or silent.** Every AI answer about a book cites passages that open the exact spot in the PDF. If retrieval finds no support, the answer says so.
5. **Users own their data.** Every annotation, note and card is exportable (Markdown, annotated PDF, Anki).
6. **Compose, don't invent.** Use the libraries named in `docs/ARCHITECTURE.md`. A new dependency or vendor needs orchestrator approval: state why, the license, and the bundle or cost impact.

## Repo layout

```
apps/web                   Next.js app: marketing, app shell, API route handlers
apps/ingest                Python worker on Modal: OCRmyPDF, Docling, chunking
packages/db                Drizzle schema, SQL migrations, RLS policies, seed      (Contract)
packages/annotation-model  Annotation types, zod schemas, coordinate transforms,
                           re-anchoring. Pure TS, zero UI deps                      (Contract)
packages/reader            ReaderEngine interface, engine adapter, React viewer
packages/sync              PowerSync schema + sync rules, upload connector         (Contract)
packages/ai                Feature-level AI API, provider router (free tiers in beta,
                           Claude at launch), prompt registry, eval sets
packages/srs               ts-fsrs wrapper, card types, review-log replay
packages/ui                Design tokens, shadcn/ui components
fixtures/pdfs              Golden PDF corpus (ROADMAP WP-04)
docs/adr                   Architecture decision records
prompts                    Build prompts for agents (personal MVP)
spikes                     Throwaway experiments, excluded from the build
```

## Contracts

Frozen at the end of Phase 0: the DB schema, the annotation model, the PowerSync sync rules, and the API zod schemas in `apps/web/src/server/contracts`. To change one, write `docs/adr/NNNN-title.md` and get orchestrator approval **before** coding. If your work package hits a contract gap, stop and report it; don't work around it.

Additive changes aren't contract changes: a new function in a contract package or a new endpoint schema is fine, as long as no existing signature, column or schema changes. A later phase adds its new tables (cards, review logs, chunks, AI, billing) through **one ADR for that phase**, approved before its first work package starts.

## Conventions

- TypeScript strict, no `any`. zod at every trust boundary: API input, sync uploads, AI structured output.
- IDs are UUIDv7 generated on the client (rows are created offline). Timestamps are `timestamptz`, UTC.
- Synced tables use soft deletes (`deleted_at`), because sync needs tombstones.
- Server reads and writes go through Drizzle; client reads go through PowerSync live queries.
- AI calls go only through the feature functions in `packages/ai` (`explain()`, `askBook()`, …). App code never imports a provider SDK, and sampling settings never appear outside provider config.
- Biome for lint and format, Vitest for unit tests, Playwright for E2E and visual regression.
- Unfinished user-visible features ship behind PostHog feature flags.
- Secrets live only in Vercel, Supabase and Modal env settings, in GitHub Actions secrets (dev project only), and in the git-ignored `.env.local`. Nothing secret goes to the client bundle.
- Two environments: `margin-dev` (local development, integration tests, E2E, CI) and `margin` (production, from P12). Tests never touch production.

## Licenses

Allowed: MIT, Apache-2.0, BSD, ISC, MPL-2.0. Ask first: LGPL, GPL. Forbidden: AGPL (e.g. PyMuPDF, MinerU) and non-commercial licenses, unless a commercial license has been bought.

## Definition of done (every work package)

- The WP's acceptance criteria from `docs/ROADMAP.md` are met and **demonstrated**: test output, plus Playwright screenshots or video for UI.
- `pnpm typecheck && pnpm lint && pnpm test` pass; database, sync, storage and auth changes also pass `pnpm test:integration`; reader and annotation changes also pass E2E against `fixtures/pdfs`.
- No regression of the performance budgets in `docs/ARCHITECTURE.md` §7.
- Changes to auth, RLS, storage or upload paths get a `/security-review` pass.
- Run `/code-review` before handing back.

## Agent tooling

- **Context7 MCP** for current library docs. EmbedPDF, PowerSync, Docling, ts-fsrs and the Vercel AI SDK move fast, so don't code their APIs from memory.
- **Supabase MCP** for schema, migrations and logs. **Playwright MCP** to verify UI in a real browser.
- Skills: `claude-api` when building the Claude adapter in `packages/ai` (WP-37); `ui-ux-pro-max`, `ui-styling` and `design-system` for UI work.

## Commands

Node 24 LTS (`.nvmrc`) and pnpm 11 (`packageManager`, via `corepack enable`). Run everything from the repo root; scripts are cross-platform.

| Command | What it does |
|---|---|
| `pnpm install` | Install the workspace |
| `pnpm dev` | Next.js dev server at http://localhost:3000 (needs `apps/web/.env.local`) |
| `pnpm build` | Production build of every app (Turborepo, cached). Works without `.env.local` |
| `pnpm typecheck` | `tsc` in every package (`next typegen` first for the web app) plus the root config files |
| `pnpm lint` | Biome lint + format check. `pnpm format` applies fixes |
| `pnpm test` | Unit tests (Vitest project `unit`): no network, no secrets. Filter by path: `pnpm test packages/db` |
| `pnpm test:integration` | `*.int.test.ts` files (Vitest project `integration`) against `margin-dev`; reads `apps/web/.env.local` or the environment |
| `pnpm e2e` | Builds, then runs Playwright (`apps/web/e2e`) against `next start` on port 3100. First run: `pnpm --filter @margin/web exec playwright install chromium` |
| `pnpm --filter @margin/web check:server-only` | Proves that importing the admin client from a Client Component fails the build |

Where things live:
- Env: `apps/web/.env.example` lists every variable; validated with zod in `apps/web/src/env.ts` (`publicEnv()` / `serverEnv()`, checked on call, not at import).
- Supabase clients: `apps/web/src/lib/supabase/{client,server,admin}.ts`. `admin.ts` uses the secret key and is guarded by `server-only`.
- Feature flags: `apps/web/src/config/flags.ts`.
- Workspace packages export TypeScript source (`"exports": "./src/index.ts"`); there's no package build step.
- Test file names: `*.test.ts` = unit, `*.int.test.ts` = integration, `apps/web/e2e/*.spec.ts` = Playwright.
- CI: `.github/workflows/ci.yml` (checks + integration on every push and PR), `.github/workflows/e2e.yml` (manual trigger).
- Next.js 16 changed a lot: read the docs bundled at `apps/web/node_modules/next/dist/docs/` before writing Next code (see `apps/web/AGENTS.md`). Cache Components is on, so request-time data goes inside `<Suspense>`.
