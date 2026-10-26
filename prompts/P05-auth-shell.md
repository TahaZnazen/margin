# P05 — Auth & app shell

> Wave 3 · Needs: P02, P03 · Parallel with: P04 · Run: `Execute prompts/P05-auth-shell.md`

## Read first
`CLAUDE.md` · `prompts/README.md` · `docs/ARCHITECTURE.md` §3, §8 · `docs/design/reader-layout.md` · `docs/PROGRESS.md`

## Goal
The user can sign in and land in a clean app shell with their settings, and nobody else can sign up.

## Build
1. **Supabase Auth** with `@supabase/ssr`: `/sign-in` offers email + password and a magic link, plus the `/auth/callback` route and sign-out. Middleware refreshes the session and protects `/app/**`. Signed-out visitors are redirected to `/sign-in`; signed-in users who open `/sign-in` go to `/app`.
2. **Sign-up lock:** env `ALLOW_SIGNUPS` (default `false`) hides the sign-up form. In PROGRESS, document how to turn off sign-ups in the Supabase dashboard after the user registers; that setting is the real guard.
3. **App shell** at `/app`: left navigation (Library, Notes, Settings), top bar with an account menu, a responsive layout (bottom bar or sheet on mobile), built from P03 tokens and components. Library and Notes are placeholder pages for now.
4. **Settings page:** theme (light / sepia / dark / system), custom labels for the 5 highlight colors, reader preferences (default zoom: fit width or fit page). Persist to `user_settings` through a `settingsRepo` interface. For now implement it with supabase-js; P06 swaps it to PowerSync without touching the UI.
5. The theme is applied app-wide from settings with no flash (P03 mechanism).
6. **E2E:** a test user is created in setup with the admin client and deleted afterwards. The test signs in, sees the shell, changes the theme, reloads and sees it persisted. A signed-out visit to `/app` redirects.

## Acceptance criteria
- [ ] E2E passes, with no session or theme flicker on reload (screenshot).
- [ ] The Supabase secret key doesn't appear in any client bundle (check the build output).
- [ ] Lighthouse accessibility ≥ 95 on `/sign-in` and `/app`.
- [ ] Sign-up is hidden when `ALLOW_SIGNUPS=false`.

## Out of scope
OAuth providers, library content, sync.
