# Golden PDF corpus

Test PDFs for every later prompt. `manifest.json` is the source of truth (source URL, license, sha256, size, what each file tests, expected facts); `../index.ts` gives typed access (`@margin/fixtures`).

```
pnpm fixtures                      # download missing files, verify sha256; a second run does nothing
pnpm --filter @margin/fixtures generate   # rebuild generated/ (then commit the manifest change)
```

Downloaded PDFs land in `downloads/` (git-ignored) and are untrusted data: they are stored and hashed, never executed. Generated files in `generated/` are committed (each under 200 KB). Put your own PDFs in `private/` (see its README).

## Cases

| id | origin | license | pages | outline | text layer | size | status | tests |
|---|---|---|---|---|---|---|---|---|
| `textbook-economics` | download | CC-BY-4.0 | 974 | yes | yes | 51.76 MB | skipped (lean MVP) | Long-document performance (virtualization, outline, search, resume position) on a real 974-page textbook with a deep outline. |
| `image-heavy-astronomy` | download | CC-BY-4.0 | 1206 | yes | yes | 161.16 MB | skipped (lean MVP) | Local performance only: memory and scrolling on a 161 MB, photo-heavy document. Never upload it. |
| `scanned-book` | download | Public-Domain | 280 | no | no | 6.12 MB | present after `pnpm fixtures` | Reading a scan with no text layer at all: renders, area highlights work, text selection is unavailable, and OCR (P13) has a real input. |
| `two-column-paper` | download | CC-BY-4.0 | 9 | yes | yes | 2.47 MB | present after `pnpm fixtures` | Selection and highlight order across two columns, inline and display equations, and internal links. |
| `slides` | download | CC-BY-4.0 | 11 | no | yes | 0.64 MB | present after `pnpm fixtures` | Slides exported to PDF: 16:9 landscape pages (720 x 405 pt), large type, images and sparse text. |
| `arabic-rtl` | download | CC-BY-SA-4.0 | 7 | yes | yes | 0.60 MB | present after `pnpm fixtures` | Right-to-left text: selection direction, highlight rects, quote extraction and search in Arabic, with the first column on the right. |
| `french-accents-ligatures` | download | CC-BY-4.0 | 94 | yes | yes | 0.83 MB | present after `pnpm fixtures` | Accented text and typographic ligatures (fi, fl, ff, ffi as single glyphs): selection, quote text, search and re-anchoring must yield the real letters. |
| `ruler` | generated | CC0-1.0 | 2 | no | yes | 0.01 MB | committed | Pixel accuracy of rendering, text selection and annotation overlays at every zoom: every text run, crosshair and box has exact documented coordinates. |
| `mixed-pages` | generated | CC0-1.0 | 6 | no | yes | 0.01 MB | committed | Coordinate transforms: rects stay correct on rotated pages, different page sizes in one document and a page whose CropBox does not start at (0, 0). |
| `annotations` | generated | CC0-1.0 | 1 | no | yes | 0.00 MB | committed | Import of highlights and sticky notes made in other apps: known QuadPoints, colors, authors and contents. |
| `javascript-forms` | generated | CC0-1.0 | 1 | no | yes | 0.01 MB | committed | Security: the viewer renders form fields but never executes document, open, page, field, button or link JavaScript. |
| `encrypted` | generated | CC0-1.0 | 1 | no | yes | 0.00 MB | committed | Password prompt, wrong-password rejection and normal reading after unlocking. |
| `corrupted` | generated | CC0-1.0 | 3 | no | yes | 0.00 MB | committed | Graceful failure on a damaged upload: clear error or partial render, never a crash or hang. |
| `size-under-cap` | generated | CC0-1.0 | 10 | no | yes | 46.99 MB | skipped (lean MVP) | Upload limit: accepted under both the decimal (50,000,000 B) and binary (52,428,800 B) reading of 50 MB. |
| `size-over-cap` | generated | CC0-1.0 | 10 | no | yes | 53.99 MB | skipped (lean MVP) | Upload limit: rejected before upload under both readings of 50 MB. |

Skipped in the lean MVP (documented, not fetched): `textbook-economics` (974 pages, 51.8 MB, the 600+ page textbook and the just-over-cap size), `image-heavy-astronomy` (161 MB, local performance only), `size-under-cap` and `size-over-cap` (47 MB and 54 MB generated upload-cap files). Remove the `status` field in the manifest to enable one. Password-protected and JavaScript + form-field cases are generated (`encrypted`, `javascript-forms`); the password is in the manifest under `expected.encryption`.

## Coordinates

`pageIndex` is 0-based. Every `rect` is `[x0, top, x1, bottom]` in PDF points relative to the page CropBox, unrotated, origin top-left (the annotation-model convention). A `knownText` entry is a text run that really is on that page; compare with the stated `tolerance` in points.

## Ruler PDF (`generated/ruler.pdf`)

Two pages: page 1 US Letter 612 x 792, page 2 A4 595.276 x 841.89. Both carry a grid (minor lines every 36 pt, major every 72 pt) and four crosshair markers at (72,72), (540,72), (72,720), (540,720) on page 1 and (72,72), (523.276,72), (72,769.89), (523.276,769.89) on page 2 (top-left origin). Page 1 has Helvetica samples at 8, 10, 12, 18, 24 and 36 pt with baselines at y = 96, 114, 136, 166, 204, 254 and x = 72; a six-line 11 pt paragraph with 15 pt leading whose first baseline is y = 320; an area box [324, 456, 540, 600]; and a bottom-margin line at baseline y = 740. Page 2 has an area box [72, 400, 300, 520]. Exact per-run rectangles, fonts and baselines are in `manifest.json` under `ruler` and `knownText`.

`mixed-pages.pdf`: six pages with different sizes and rotations (90, 180, 270) and a non-zero CropBox offset on one page (details in `expected.pages`). `annotations.pdf`: existing /Highlight and /Text annotations with known QuadPoints, colors and contents (`expected.annotations`). `corrupted-truncated.pdf`: a valid file cut off mid-stream.
