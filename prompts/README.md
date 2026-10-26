# Build prompts: personal MVP (no AI, no payments)

These prompts build Phase 0 and Phase 1 of `docs/ROADMAP.md` for one user: you. You upload PDFs, read them, highlight, comment, take notes, and import or export your highlights. Everything syncs across your devices and works offline. AI (Phase 2) and billing (Phase 3) come later; the code leaves clean places for them.

## Before you start (one time, about 30 minutes)

0. **Move the project out of OneDrive**, for example to `C:\dev\margin`, and reopen that folder in VS Code. OneDrive tries to sync `node_modules` and build output (tens of thousands of files), which causes file locks and random `EPERM` errors during installs.
1. Install Node.js LTS, Git and the GitHub CLI. Then run `corepack enable` (this provides pnpm) and `gh auth login`.
2. Create free accounts (no card needed): **GitHub**, **Supabase**, **PowerSync**. **Vercel** comes at P12.
   - Supabase: create a project named `margin-dev` for development and tests. Pick the region you'd want for a future beta (the roadmap default is EU), because a project can't change region later. Keep the project URL, the publishable key, the secret key and the database password somewhere safe. You'll paste them into `apps/web/.env.local`, never into the chat. Your production project, `margin`, comes at P12 in the same region. Until then every local run and every test uses `margin-dev`, so tests never touch your real library.
   - PowerSync: just create the account. P06 connects an instance to `margin-dev`; P12 adds a second one for production.
3. Connect these MCP servers so the agents get current docs and a real browser (if a command fails, check that project's README):
   ```
   claude mcp add --transport http context7 https://mcp.context7.com/mcp
   claude mcp add --transport http supabase https://mcp.supabase.com/mcp
   claude mcp add playwright npx @playwright/mcp@latest
   ```
4. Pick 3–5 PDFs you actually read. After P01 you'll drop them into `fixtures/pdfs/private/` (git-ignored), so every test also runs on your real files.

## How to run a prompt

- **One prompt = one fresh Claude Code conversation**, so each starts with a clean context. Type: `Execute prompts/P02-contracts.md`
- When it finishes, read the summary. Every acceptance criterion should be ✅. Try the "Try it" steps yourself, then merge: `Merge branch p02-contracts into main`
- **Parallel waves are optional** and use more of your Claude usage. Either open one conversation per prompt (each works in its own git worktree), or let one session run the whole wave: `Read prompts/ORCHESTRATOR.md and act as the orchestrator. Run wave 2.`

## Order

| Wave | Prompts | Parallel? |
|---|---|---|
| 1 | [P00 Foundations](P00-foundations.md) | — |
| 2 | [P01 Golden PDF corpus](P01-corpus.md) · [P02 Contracts](P02-contracts.md) · [P03 Design system](P03-design-system.md) | Yes |
| 3 | [P04 Engine spike](P04-engine-spike.md) · [P05 Auth & app shell](P05-auth-shell.md) | Yes |
| 4 | [P06 Sync foundation](P06-sync.md) · [P07 Reader core](P07-reader-core.md) | Yes |
| 5 | [P08 Upload, library & reading flow](P08-upload-library.md) | — |
| 6 | [P09 Annotation layer](P09-annotations.md) | — |
| 7 | [P10 Panel & notebook](P10-panel-notebook.md) · [P11 Import & export](P11-import-export.md) | Yes |
| 8 | [P12 Offline, polish & deploy](P12-polish-deploy.md) | — |
| Optional | [P13 OCR for scanned PDFs](P13-ocr-optional.md) (needs a Modal account) | Any time after P08 |

## MVP simplifications (vs. `docs/ARCHITECTURE.md`)

| Architecture target | MVP choice | Why | Revisit when |
|---|---|---|---|
| Cloudflare R2 | **Supabase Storage** behind a `StorageProvider` interface | No extra account, and R2 asks for a payment method even on its free tier. Storage access rules come built in. Limits: **50 MB per file, 1 GB total** | You need files over 50 MB, or at launch |
| `/api/sync/upload` write API | PowerSync uploads straight through supabase-js; RLS and DB constraints do the validation | Fewer moving parts for one user | Billing and plan limits arrive |
| Google / Apple sign-in | Email + password and magic link; public sign-up off once you've registered | Personal use | Before a beta |
| OCRmyPDF on Modal | Optional P13 | Needs another account | You hit scanned books |
| PostHog, Sentry | None yet | Personal use | Before a beta |
| PostHog feature flags | `apps/web/src/config/flags.ts` (e.g. `ai: false`) | Same | Before a beta |

## Free-tier catches

- Supabase Free projects **pause after about a week of inactivity**, and so do PowerSync Free instances. If you've been away, restore them from their dashboards.
- Supabase Free allows **2 active projects** and PowerSync Free **2 instances**. Dev and production use both, so there's no spare slot. A paused Supabase project doesn't count toward the limit.
- Supabase Free has 50 MB per file, 1 GB storage, a 500 MB database and **no automatic backups**. P11's "Export everything" is your backup; run it now and then.
- Vercel Hobby is for non-commercial use. That's fine now; move to Pro before you charge anyone.

## Standard rules (every prompt follows these)

1. Start from an up-to-date `main` on a new branch `pNN-<slug>` (P00 is the exception: it creates `main`). If another prompt is running in parallel, work in your own git worktree.
2. Read every file under "Read first" before writing code. Look up library APIs in current docs (Context7 MCP); don't code fast-moving APIs from memory.
3. Stay in scope. The contracts (DB schema, annotation model, sync config, API schemas in `apps/web/src/server/contracts`) are frozen after P02. Additive changes aren't contract changes: a new function in a contract package or a new endpoint schema is fine, as long as no existing signature, column or schema changes. For a real change, stop and report it with a proposed ADR.
4. Add only the dependencies named in your prompt or in `docs/ARCHITECTURE.md`. If you need another one, stop and ask, stating its license and size.
5. The dev machine runs Windows 11, so package scripts must be cross-platform (no bash-only syntax in `package.json`).
6. Prove every acceptance criterion: automated tests where possible, and Playwright screenshots saved in `evidence/pNN/` (git-ignored) for UI.
7. Before finishing, run `pnpm typecheck && pnpm lint && pnpm test`, plus `pnpm test:integration` when you touched the database, sync, storage or auth, and `pnpm e2e` when UI changed. Then run `/code-review` on your diff and fix what it finds.
8. Append an entry to `docs/PROGRESS.md`: what you built, key files, commands, deviations, follow-ups.
9. Commit in logical steps. **Don't merge to `main`.** End your reply with: each acceptance criterion ✅ or ❌, "Try it" steps a person can follow, and open questions.
10. Never commit secrets. Never ask the user to paste secrets into the chat; have them edit `.env.local`. Never weaken RLS, and never skip or loosen a test to make it pass. Integration and E2E tests run only against the dev project (`margin-dev`), never production.
