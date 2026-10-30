# Overnight build log

Autonomous run started 2026-10-28 (night). Queue: highlight bug fixes → P06 sync & offline → UX pass (ebook-style chapters + page thumbnails in the reader, real-user walkthrough) → P12 PWA & polish (no deploy).
Rules: no deploys, no new accounts, no secret or dashboard changes, no force-push, never weaken RLS or tests. Anything that needs you is listed under "Needs you".

## Progress

- ✅ **Highlight bug fixes** merged and pushed.
  - Delete: selecting or double-clicking inside a highlight now opens *that* highlight (with a labelled **Delete** button) instead of a new-highlight popup; the side panel items also have a trash button.
  - Line spill: dragging past the end of a line no longer selects the rest of the column; the selection snaps to the line.
  - Overlaps: selecting inside a highlight edits it (1–5 recolors it); selecting across highlights **merges** them into one (comments joined, notebook links kept). One Ctrl+Z undoes a merge.
  - Tests: 233 unit, 62 integration, E2E 45/45 twice (new tests use real mouse drags, double and triple clicks).
- ✅ **P06 sync & offline** merged and pushed.
  - All reads and writes now go to a local database on your device first, then sync through PowerSync in the background.
  - Measured: a highlight shows up in about 6 ms; the same change appears on a second device in 0.3–0.5 s.
  - Offline: 50 highlights made with no internet all reached the database within 1.4 s of reconnecting.
  - Closing the tab right after a write loses nothing. A bad write goes to a visible "sync errors" list instead of blocking the queue. Signing out wipes the local copy.
  - New: a sync status indicator (synced / syncing / offline / errors) in the top bar and the reader.
  - Security review: no findings (uploads still go through your own session, so the database rules apply).
  - Tests: 241 unit, 62 integration, E2E 51/51 twice.
  - Note: reopening the app *while offline* needs P12 (it stores the app itself on your device).
- ✅ **Ebook-style reader + real-user walkthrough** merged and pushed (interrupted once by a network drop, resumed).
  - Left sidebar in the reader (`O` toggles it): **Chapters** (table of contents, current chapter highlighted, click to jump, "Copy link" per chapter), **Pages** (thumbnails for every page — fixes the "only page 9" bug), **Bookmarks**.
  - Links like `/app/read/<book>#p=42` open at page 42. The current chapter shows under the title, with a "Next chapter" button at the end of a chapter.
  - PDFs without a table of contents get one guessed from big headings, or a clear message.
  - Walkthrough fixes: reader buttons moved into the header (they covered the page on phones), one-tap theme switch on phones, visible selected theme, loading skeleton instead of a blank page, settings labels no longer blank while loading.
  - Left for later: upload cards linger at the bottom of the library on phones; no zoom buttons in the reader (two-column papers are small on phones); guessed chapters can be wrong on unusual PDFs.
  - Tests: 250 unit, 62 integration, E2E 67/67 twice.
- ✅ **P12 installable app & polish** merged and pushed (no deploy).
  - Installable app (an "Install" button in the account menu and Settings, shown when your browser offers it). After one online visit, the library and opened books **work with no internet**; highlights and notes made offline sync when you reconnect.
  - "Keep offline" per book (book menu) and **Settings → Storage** (what's saved on this device, sizes, remove).
  - **Ctrl+K** command palette (open a book, go to a page or chapter, find a highlight, theme, settings) and a **?** shortcut sheet.
  - **Zoom buttons** in the reader (a menu on phones); on phones the top bar hides as you scroll down and comes back on scroll up.
  - Accessibility: no serious issues left on the main screens in light and dark (axe scan); a keyboard-only walkthrough passes.
  - A root **README.md** with setup from scratch.
  - Fixed during merge: two hard-coded colors (install manifest) now come from the design tokens.
  - Tests: 251 unit, 62 integration, E2E 83/83 twice.

## Summary

Everything queued is done and on `main` (CI green). Margin now: sign in → upload → ebook-style reader (chapters, pages, bookmarks) → highlights, comments, notebook → export, works offline, installs like an app.

Known flaky test: the phone "top bar returns on scroll up" test failed once under full-suite load (passed 28/28 when repeated alone). Follow-up: make its scroll timing deterministic.

Left for later (see `docs/PROGRESS.md`): Lighthouse and performance runs, pinch-zoom on a real phone, area highlights, tags, re-anchoring, collections.

## Needs you

- **Deploy (put Margin online)**: needs you to create the production Supabase project and a second PowerSync instance, then connect Vercel. The steps are in the P12 entry of `docs/PROGRESS.md`; we can do them together.
- **Lock sign-ups** if not done yet: `ALLOW_SIGNUPS=false` in `apps/web/.env.local`, and Supabase → Authentication → Sign In / Providers → turn off "Allow new users to sign up".
- **Try it**: restart `pnpm dev`, and on your phone later (after deploy) check that pinch-zoom and install work.
