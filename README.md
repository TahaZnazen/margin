# Margin

Margin is a web app for reading PDFs and remembering what you read. Upload a book, read it, highlight and take notes; later phases add AI explanations grounded in the book and spaced-repetition review that always links back to the exact passage.

What works today:

- **Library and reader**: upload PDFs (they are readable the moment the bytes land), ebook-style sidebar (chapters, pages, bookmarks), zoom, themes (light, sepia, dark).
- **Highlights and notes**: five highlight colors, notes, a notebook, bookmarks, undo. Annotations are stored in PDF page coordinates plus a text quote, never in viewer pixels.
- **Local-first**: every write lands in a local SQLite database first and syncs in the background (PowerSync, Supabase). Nothing waits on the network.
- **Offline PWA**: installable; `/app` and the books you opened (or marked "Keep offline") open with the network off, and what you wrote offline syncs when you reconnect.
- **Command palette** (`Ctrl/Cmd+K`) and a shortcut sheet (`?`).
- **Your data is yours**: export everything as Markdown, an annotated PDF, or a zip.

Product, architecture and plan live in `docs/`: [PRODUCT](docs/PRODUCT.md), [ARCHITECTURE](docs/ARCHITECTURE.md), [ROADMAP](docs/ROADMAP.md), [PROGRESS](docs/PROGRESS.md), the reader layout spec in [docs/design/reader-layout.md](docs/design/reader-layout.md) and decisions in [docs/adr](docs/adr). Agents working in this repo start from [CLAUDE.md](CLAUDE.md).

## Setup from scratch

You need Node 24 (`.nvmrc`) and pnpm 11 (`corepack enable`), plus free accounts at:

- **Supabase** (database, auth, file storage). Create a project named `margin-dev`.
- **PowerSync Cloud** (sync). Create an instance for it later in these steps.

1. **Install**
   ```
   corepack enable
   pnpm install
   ```
2. **Environment.** Copy `apps/web/.env.example` to `apps/web/.env.local` and fill in each variable; the file says where in the dashboards each value lives. `.env.local` is git-ignored: never commit it or paste its values anywhere.
   | Variable | What |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase project URL and publishable key (safe in the browser) |
   | `SUPABASE_SECRET_KEY` | Secret key, server only |
   | `DATABASE_URL`, `DATABASE_CA_CERT` | Session-pooler Postgres URL and Supabase's CA certificate (migrations, integration tests) |
   | `NEXT_PUBLIC_POWERSYNC_URL` | PowerSync instance URL |
   | `POWERSYNC_DB_PASSWORD` | Password for the `powersync_role` database role |
   | `ALLOW_SIGNUPS` | `true` once to create your account, then `false` |
3. **Test PDFs** (the golden corpus used by unit and E2E tests): `pnpm fixtures`
4. **Database**: `pnpm db:migrate` applies the SQL migrations (schema, RLS policies, storage bucket, PowerSync publication) to the project in `DATABASE_URL`.
5. **Sync**: follow [packages/sync/README.md](packages/sync/README.md) (`pnpm db:powersync-role`, create the PowerSync instance, deploy `packages/sync/powersync.yaml`).
6. **Account**: set `ALLOW_SIGNUPS=true`, run the app, register at `/sign-in`, then set it back to `false` and turn off "Allow new users to sign up" in Supabase (Authentication → Sign In / Providers). That dashboard switch is the real guard.
7. **Run**: `pnpm dev`, then open http://localhost:3000.

Production deployment (Vercel, a second Supabase project and PowerSync instance) is not set up yet; it is the deferred part of work package P12 (see `docs/PROGRESS.md`).

## Commands

Run everything from the repo root.

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server on http://localhost:3000 (the service worker is built but only registers in production builds) |
| `pnpm build` | Production build of every app |
| `pnpm typecheck` | `tsc` in every package, plus the service worker |
| `pnpm lint` / `pnpm format` | Biome lint and format check / apply fixes |
| `pnpm test` | Unit tests (no network, no secrets); filter by path: `pnpm test packages/db` |
| `pnpm test:integration` | `*.int.test.ts` against `margin-dev` |
| `pnpm e2e` | Playwright against a clean production build (`PLAYWRIGHT_PORT` picks the port, default 3100). First run: `pnpm fixtures` and `pnpm --filter @margin/web exec playwright install chromium` |
| `pnpm db:generate` / `pnpm db:migrate` | Create / apply Drizzle migrations |

Tests only ever touch `margin-dev`, never production.

## Repo layout

```
apps/web                   Next.js app: marketing, app shell, API routes, service worker (sw/)
apps/ingest                Python worker (planned): OCR, structure, chunking
packages/db                Drizzle schema, SQL migrations, RLS policies
packages/annotation-model  Annotation types, zod schemas, coordinate transforms
packages/reader            ReaderEngine interface, PDF.js adapter, React viewer
packages/sync              PowerSync schema, sync config, upload connector
packages/ui                Design tokens ("Calm paper"), shadcn/ui components
fixtures/pdfs              Golden PDF corpus
docs                       Product, architecture, roadmap, progress, ADRs
prompts                    Build prompts for agents
```

## License notes

Dependencies must be MIT, Apache-2.0, BSD, ISC or MPL-2.0; ask before adding LGPL or GPL, never add AGPL or non-commercial licenses.
