import { z } from "zod";
import { HighlightColor, QUOTE_CONTEXT_LENGTH } from "./vocabulary";

/**
 * `annotations.target` (docs/ARCHITECTURE.md §4, ADR 0001).
 *
 * Coordinates are PDF points relative to the page CropBox, unrotated, with the origin at the
 * top-left. They're independent of zoom, rotation, device and engine.
 */

/** `[x1, y1, x2, y2]` in PDF points; `x1 <= x2` and `y1 <= y2`. */
export type Rect = [x1: number, y1: number, x2: number, y2: number];

export const Rect = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine(([x1, y1, x2, y2]) => x1 <= x2 && y1 <= y2, {
    message: "A rect is [x1, y1, x2, y2] with x1 <= x2 and y1 <= y2",
  });

/** 0-based page index. */
export const PageIndex = z.int().nonnegative();

/** Hint only: UTF-16 offsets into the page text the selection was made on. */
export const TextPos = z
  .strictObject({ start: z.int().nonnegative(), end: z.int().nonnegative() })
  .refine((pos) => pos.end >= pos.start, { message: "textPos.end must be >= textPos.start" });
export type TextPos = z.infer<typeof TextPos>;

/** W3C TextQuoteSelector shape: the exact text plus up to 32 characters of context each side. */
export const Quote = z.strictObject({
  exact: z.string().min(1),
  prefix: z.string().max(QUOTE_CONTEXT_LENGTH),
  suffix: z.string().max(QUOTE_CONTEXT_LENGTH),
});
export type Quote = z.infer<typeof Quote>;

/** Content hash of the PDF the annotation was made on: `sha256:` + 64 lowercase hex digits. */
export const Fingerprint = z.string().regex(/^sha256:[0-9a-f]{64}$/, {
  message: "fingerprint must be sha256:<64 lowercase hex digits>",
});

// highlight: >= 1 segment (one per page spanned, in page order), >= 1 rect per segment (one per
// line), optional textPos, required quote.
const HighlightSegment = z.strictObject({
  page: PageIndex,
  rects: z.array(Rect).min(1),
  textPos: TextPos.optional(),
});

export const HighlightTarget = z.strictObject({
  fingerprint: Fingerprint,
  // A tuple with a rest element types as non-empty: [first, ...rest].
  segments: z.tuple([HighlightSegment], HighlightSegment).refine(
    (segments) => {
      const pages = segments.map((segment) => segment.page);
      return pages.every((page, i) => i === 0 || page > (pages[i - 1] as number));
    },
    { message: "Highlight segments are one per page, in increasing page order" },
  ),
  quote: Quote,
});
export type HighlightTarget = z.infer<typeof HighlightTarget>;

// area: exactly 1 segment with exactly 1 rect (the drawn region); no textPos, no quote.
export const AreaTarget = z.strictObject({
  fingerprint: Fingerprint,
  segments: z.tuple([z.strictObject({ page: PageIndex, rects: z.tuple([Rect]) })]),
});
export type AreaTarget = z.infer<typeof AreaTarget>;

// bookmark: exactly 1 segment with 0 rects, or 1 marking a spot; no textPos, no quote.
export const BookmarkTarget = z.strictObject({
  fingerprint: Fingerprint,
  segments: z.tuple([z.strictObject({ page: PageIndex, rects: z.array(Rect).max(1) })]),
});
export type BookmarkTarget = z.infer<typeof BookmarkTarget>;

/**
 * Any valid target. On its own it can't tell an area from a one-rect bookmark; validate rows with
 * {@link AnnotationShape}, which checks the target against `kind`.
 */
export const AnnotationTarget = z.union([HighlightTarget, AreaTarget, BookmarkTarget]);
export type AnnotationTarget = z.infer<typeof AnnotationTarget>;

/** `annotations.page_start`: the first segment's page. */
export function pageStart(target: AnnotationTarget): number {
  return target.segments[0].page;
}

/**
 * The annotation fields that must agree with each other ("Target by kind", ARCHITECTURE §4),
 * discriminated on `kind`, plus `page_start` when given. `ink` has no member, so ink rows are
 * rejected until an ADR defines strokes. Other row fields are stripped from the parsed output.
 */
export const AnnotationShape = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("highlight"),
      color: HighlightColor,
      target: HighlightTarget,
      quote_text: z.string().min(1),
      page_start: PageIndex.optional(),
    }),
    z.object({
      kind: z.literal("area"),
      color: HighlightColor.nullish(),
      target: AreaTarget,
      quote_text: z.null().optional(),
      page_start: PageIndex.optional(),
    }),
    z.object({
      kind: z.literal("bookmark"),
      color: z.null().optional(),
      target: BookmarkTarget,
      quote_text: z.null().optional(),
      page_start: PageIndex.optional(),
    }),
  ])
  .refine((row) => row.page_start === undefined || row.page_start === pageStart(row.target), {
    message: "page_start must be the first segment's page",
    path: ["page_start"],
  });
export type AnnotationShape = z.infer<typeof AnnotationShape>;
