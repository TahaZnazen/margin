# P12 — Offline, polish & deploy

> Wave 8 · Needs: P10, P11 · Run: `Execute prompts/P12-polish-deploy.md`

## Read first
`CLAUDE.md` · `prompts/README.md` (free-tier catches) · `docs/ARCHITECTURE.md` §7, §8 · `docs/PRODUCT.md` (UX principles) · `docs/PROGRESS.md`

## Goal
It feels like a native app on your laptop, tablet and phone, works offline, and is live at your own URL.

## Build
1. **PWA:** web manifest, icons (a simple logo mark built from P03 tokens), and a service worker via Serwist (`@serwist/next`) that caches the app shell and static assets, so `/app` opens offline. Add an install prompt.
2. **Offline library:**
   - books are already cached in OPFS when opened (P08); add a "Keep offline" toggle per book that prefetches it
   - Settings → Storage lists cached books with their sizes and a "Free up space" action, and shows quota from `navigator.storage.estimate()`
   - request persistent storage with `navigator.storage.persist()`
3. **Command palette** (ctrl/cmd+K, cmdk): open a book (fuzzy search), go to page N, jump to a chapter, search annotations, toggle theme, toggle panels, open settings. A shortcut sheet opens on `?`.
4. **Touch and small screens:** the selection popover works with long-press selection on iPad and Android; panels are sheets; pinch zoom works; the top bar hides on scroll.
5. **Quality passes:**
   - re-run the performance budget suite and fix regressions
   - accessibility: axe (`@axe-core/playwright`) on the main screens, plus a keyboard-only walkthrough of upload → read → highlight → note
   - an empty state and an error state on every screen; loading skeletons
6. **Deploy to Vercel (Hobby):**
   - production environment: the user creates the Supabase project `margin` in the same region as `margin-dev`. Apply the migrations, the storage bucket and the PowerSync prerequisites to it, connect a second PowerSync instance and deploy the sync config. Write every dashboard click as a numbered step in PROGRESS.
   - tell the user production starts empty: books and highlights made in `margin-dev` stay there
   - guide the user through connecting the GitHub repo and setting env vars to the production values (list them)
   - set the Supabase Auth site URL and redirect URLs for the production domain
   - the user registers on production, then sign-ups are disabled there too
   - update PowerSync allowed origins if needed
   - run a read-only Playwright smoke test against the live URL
7. Root `README.md`: what the product is, setup from scratch, commands, and pointers to the docs.

## Acceptance criteria
- [ ] With the network off, the installed app opens, the library shows, a cached book opens, and highlights and notes can be created. After reconnecting, they sync.
- [ ] The app is installable; Lighthouse accessibility ≥ 95 on the library and reader; axe reports no serious or critical violations.
- [ ] The full E2E suite passes locally; the smoke suite passes against production.
- [ ] The user confirms it works on their phone and tablet (screenshots).

## Out of scope
AI, billing, telemetry, native apps.
