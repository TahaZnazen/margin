# P03 — Design system

> Wave 2 · Needs: P00 · Parallel with: P01, P02 · Run: `Execute prompts/P03-design-system.md`

## Read first
`CLAUDE.md` · `prompts/README.md` · `docs/PRODUCT.md` (UX principles, semantic colors) · `docs/ARCHITECTURE.md` §2
Load the `design-system`, `ui-ux-pro-max` and `ui-styling` skills before starting.

## Goal
The visual foundation (tokens, themes, highlight palette, reader layout), so every later screen looks like one calm, premium reading product.

## Build
1. **Direction.** The page is the hero and the chrome stays quiet. Typography is precise, motion is subtle, and the product is fast to scan. Build two candidate directions as screenshots of the `/dev/ui` page, **ask the user to pick one**, then finish with that one.
2. **Tokens** in `packages/ui` as CSS variables wired into Tailwind v4 `@theme`:
   - semantic colors: background, surface, text, muted, border, accent, danger, success
   - type scale: a UI font, plus an optional serif for book titles
   - spacing, radius, shadow, motion durations and easings
   Three themes (**light, sepia, dark**) plus "system". The theme class is set on `<html>` before first paint, so there's no flash.
3. **Highlight palette** for the 5 semantic colors (key, definition, example, memorize, confusing). Each color defines: a fill for light and sepia pages (multiply blend), a fill for dark mode (test on a dimmed page and on an inverted page), an underline color, and a chip color for UI. Requirements: text under any highlight keeps ≥ 4.5:1 contrast, and the 5 colors stay distinguishable under protanopia, deuteranopia and tritanopia simulation. Document the numbers.
4. **Components** with shadcn/ui (follow its current monorepo guidance) and lucide-react icons: Button, IconButton, Input, Textarea, Dialog, Sheet, Popover, Tooltip, DropdownMenu, Tabs, Toast (sonner), ScrollArea, Separator, Skeleton, Command (cmdk), ToggleGroup, Progress, Badge.
5. **Reader layout spec** in `docs/design/reader-layout.md`, plus a static mock at the dev-only route `/dev/reader-mock`. It covers:
   - top bar that auto-hides while reading (title, page n/N, zoom, theme, panel toggles)
   - left rail (outline / thumbnails / bookmarks) and right panel (annotations / notebook)
   - selection popover: 5 color dots, Note, Copy with citation, plus hidden reserved slots for Explain and Make card
   - bottom progress line
   - mobile, where panels become sheets
   - the full keyboard map from PRODUCT.md
6. **`/dev/ui`** (dev-only, excluded from production): every token and component in all three themes.

## Acceptance criteria
- [ ] `/dev/ui` renders every component in light, sepia and dark, with no hard-coded colors outside the tokens (add a lint or grep check to CI).
- [ ] Palette contrast and colorblind checks are documented with numbers.
- [ ] No theme flash on reload (screenshot evidence).
- [ ] `/dev/reader-mock` works at 375 px, 768 px and 1440 px (screenshots).
- [ ] The user picked the design direction.

## Out of scope
Real data, auth, the real reader.
