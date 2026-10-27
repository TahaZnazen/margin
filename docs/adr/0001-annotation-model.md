# ADR 0001 — Annotation model: PDF-space rects plus a text quote

Status: Accepted · 2026-10-26 · Contract (ARCHITECTURE §3, §4)

## Context

Annotations are the user's most valuable data ("never lose a highlight"). They must survive zoom, rotation, devices, engine swaps (EmbedPDF ↔ PDF.js, decided in WP-02) and re-uploads of a different edition. They also have to export to real PDF annotations (`/QuadPoints`) and to Markdown and Anki. Viewer pixels and engine-private formats fail every one of these requirements.

## Decision

1. **Coordinates.** An annotation stores `target` (jsonb) with rects in **PDF points**, relative to the page CropBox, **unrotated**, with the **origin at the top-left**: `Rect = [x1, y1, x2, y2]`, with `x1 ≤ x2` and `y1 ≤ y2`. Pages are 0-based. `pageToViewport` and `viewportToPage` (`@margin/annotation-model`) are the only conversion to and from the screen. `view = { pageWidth, pageHeight, rotation, scale }`, where rotation is clockwise (0/90/180/270) and scale is CSS pixels per point. Round trips are exact to within 0.5 pt (property-tested for every rotation at zoom 0.5, 1, 2 and 3).
2. **Shape (W3C Web Annotation-like).**
   ```jsonc
   { "fingerprint": "sha256:<64 lowercase hex = documents.sha256>",
     "segments": [{ "page": 41, "rects": [[72, 310.5, 523.2, 324.1]], "textPos": { "start": 1203, "end": 1288 } }],
     "quote": { "exact": "…", "prefix": "≤32 chars", "suffix": "≤32 chars" } }
   ```
   `textPos` is a hint: UTF-16 offsets into the engine's page text. `quote` is a TextQuoteSelector built by `buildQuote()`, which never splits a surrogate pair. `mergeLineRects()` turns character boxes into one rect per line. It never shrinks the covered area, and it keeps rects on either side of a column gutter separate.
3. **Target by kind.** `kind` is its own column, so `{kind, color, target, quote_text, page_start}` are validated together. `AnnotationShape` is a zod union discriminated on `kind`, with one strict target schema per kind:

   | Kind | Segments | Rects per segment | `textPos` | `quote` / `quote_text` | `color` |
   |---|---|---|---|---|---|
   | `highlight` | ≥ 1, one per page, increasing | ≥ 1, one per line | optional | required (non-empty) | required |
   | `area` | exactly 1 | exactly 1 | absent | absent / null | optional |
   | `bookmark` | exactly 1 | 0 or 1 | absent | absent / null | null |
   | `ink` | reserved for Phase 4: the DB accepts the kind with any JSON object target; zod rejects it until an ADR defines strokes | | | | |

   `page_start` must equal the first segment's page (`pageStart(target)`).
4. **The database enforces what SQL can express** (`packages/db/src/schema.ts`): enum CHECKs built from the same constant lists (`ANNOTATION_KINDS`, `HIGHLIGHT_COLORS`, `ANCHOR_STATUSES`); a highlight has a color and a non-empty `quote_text`; area and bookmark have no `quote_text`; a bookmark has no color; and `annotations_target_check` covers segment and rect counts per kind, quote presence and `page_start`. Rect geometry, the fingerprint format and textPos are checked by zod only. Writes from PowerSync reach Postgres directly, so the DB checks are the backstop.
5. **Colors are semantic keys** (`key`, `definition`, `example`, `memorize`, `confusing`; default labels "Key idea", "Definition", "Example", "Memorize", "Confusing"). Hues and renamed labels are presentation (`user_settings.highlight_labels`).
6. **Anchoring on load** (implemented in P09): if the fingerprint matches, use the rects directly. Otherwise fuzzy-match the quote within ±3 pages and set `anchor_status = 'reanchored'`. If nothing matches, set `'orphaned'`; an orphaned annotation is never deleted.

## Consequences

- Rendering, export and re-anchoring are engine-independent. An engine adapter only needs `selectionToTarget` and `targetToViewport`.
- `quote_text` duplicates `target.quote.exact` for search. Writers keep them equal; that isn't enforced.
- Adding a kind, changing a target shape or changing the coordinate convention is a contract change: it needs a new ADR, a migration for the CHECKs, and a schema version bump.
- Ink annotations can be stored once Phase 4 lands without a DB migration, but the zod schema needs its own ADR first.
