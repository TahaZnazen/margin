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
- ⏳ **UX pass (ebook-style reader, real-user walkthrough)**: agent running.

## Needs you

- Nothing yet.
