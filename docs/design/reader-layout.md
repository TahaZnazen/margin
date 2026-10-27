# Reader layout spec

Direction: **Calm paper**. The page is the hero; chrome is quiet, warm and neutral, and gets out of the way. Tokens: `packages/ui/src/styles/tokens.css`. Geometry variables: `--reader-topbar-h` (3rem), `--reader-rail-w` (16rem), `--reader-panel-w` (22rem), `--reader-progress-h` (2px).

## Regions (desktop >= 1024 px)

```
+------------------------------------------------------------------+
| top bar (auto-hides)                                             |
+--------+-----------------------------------------+---------------+
| left   |                                         | right panel   |
| rail   |              page canvas                | annotations / |
| 16rem  |       (centered, --page-bg behind)      | notebook 22rem|
+--------+-----------------------------------------+---------------+
| bottom progress line (2px, full width)                           |
+------------------------------------------------------------------+
```

- **Top bar** (3rem): back to library, book title (serif, truncated), `page n / N` (tabular numerals, click to jump), zoom (- / % / +, fit width / fit page), theme switch (system, light, sepia, dark), toggles for left rail and right panel, overflow menu. It fades out (`--duration-chrome`, 480 ms) after 2.5 s without pointer or key activity while reading, and returns on pointer movement to the top edge, on any mouse move after a pause, on `Esc`, or when a popover or menu is open. It never covers the page: the canvas starts under it only while it is visible; hiding it does not shift the page.
- **Left rail** (16rem, collapsible, `[`): tabs Outline / Thumbnails / Bookmarks. Current section highlighted. Thumbnails lazy-render.
- **Right panel** (22rem, collapsible, `]`): tabs Annotations (list by page, filter by the 5 colors) and Notebook (notes). Clicking an item scrolls to and flashes the exact passage.
- **Canvas**: page centered on `--page-bg`, soft `--shadow-md`. Dark theme dims the page (`--page-filter: brightness(0.8)`); an option inverts it (`invert(0.9) hue-rotate(180deg)`). Highlight fills use `mix-blend-mode: var(--hl-blend)`.
- **Bottom progress line**: 2 px, accent on `--border`, shows position through the book; hover shows `page n / N` and chapter; click seeks. Always visible, even when the top bar is hidden.

## Selection popover

Appears above the selection (below if no room), 8 px gap, `--shadow-md`, radius `lg`, enter 140 ms fade and 4 px rise.

Order: **5 color dots** (key, definition, example, memorize, confusing; chips from `--hl-*-chip`; keys `1`-`5`), divider, **Note** (`N`), **Copy with citation** (`Shift+C`; copies the quote plus title and page, with a link to the passage). Reserved, hidden behind feature flags until their phases: **Explain** (`E`) and **Make card** (`C`). Reserved slots keep their place in the DOM (`hidden`) so layout and shortcuts do not move when they ship. Applying a color closes the popover and keeps the selection cleared. Touch: same popover, hit targets >= 44 px.

## Mobile (< 768 px) and tablet (768-1023 px)

- Top bar shrinks to back, title, page n/N, and a menu. Auto-hides on scroll down, returns on scroll up or tap on the center.
- Left rail and right panel become **sheets**: rail from the left (85% width, max 20rem), panel from the bottom (max 80% height, drag handle). One open at a time; the page stays behind a `--scrim`.
- Tablet: rail or panel may dock (one at a time) next to the page; the other is a sheet.
- Selection popover docks to the bottom edge above the progress line when the selection is near the top.
- Pinch zoom is native; the zoom control opens a popover with fit modes.

## Keyboard map

| Key | Action |
|---|---|
| `Cmd/Ctrl+K` | Command palette |
| `Cmd/Ctrl+F` or `/` | Find in book |
| `J` / `K`, `Down` / `Up`, `Space` / `Shift+Space` | Scroll down / up, page down / up |
| `PageDown` / `PageUp`, `Right` / `Left` | Next / previous page |
| `Home` / `End` | First / last page |
| `G` | Go to page |
| `+` / `-` / `0` | Zoom in / out / fit width |
| `T` | Cycle theme (light, sepia, dark) |
| `[` / `]` | Toggle left rail / right panel |
| `Esc` | Close popover or dialog, then show the top bar, then clear selection |
| `1`-`5` | With a selection: apply the color (key, definition, example, memorize, confusing) |
| `N` | With a selection: add a note (also on a focused highlight) |
| `Shift+C` | With a selection: copy with citation |
| `E` | With a selection: Explain (reserved) |
| `C` | With a selection: Make card (reserved) |
| `Backspace` / `Delete` | With a focused highlight: remove it (undo available for 10 s) |
| `Z` with `Cmd/Ctrl` | Undo the last annotation change |
| `?` | Show this shortcut list |

Single-key shortcuts are off while a text field has focus. Every shortcut also appears in a tooltip or menu item (`Kbd`).

## Accessibility and motion

- Focus ring is `--focus-ring`, 2 px offset; all chrome is reachable by Tab in reading order (top bar, rail, page, panel).
- Chrome text meets 4.5:1 in all three themes; highlights meet it per `palette.md`.
- Motion uses the duration and easing tokens and collapses to 0 ms under `prefers-reduced-motion`.

## Follow-up

The static `/dev/reader-mock` route (375, 768 and 1440 px screenshots) was skipped in the lean build of P03; build it with the first reader work package.
