import { z } from "zod";

/**
 * The closed vocabularies of the annotation model. `@margin/db` builds its CHECK constraints from
 * these lists, so the database and the zod schemas can't drift apart.
 */

/** `ink` is reserved for Phase 4: the DB accepts it, the zod target schemas reject it (ADR 0001). */
export const ANNOTATION_KINDS = ["highlight", "area", "bookmark", "ink"] as const;
export const AnnotationKind = z.enum(ANNOTATION_KINDS);
export type AnnotationKind = z.infer<typeof AnnotationKind>;

/** Semantic highlight colors. The key is stored; the label and the hue are presentation. */
export const HIGHLIGHT_COLORS = ["key", "definition", "example", "memorize", "confusing"] as const;
export const HighlightColor = z.enum(HIGHLIGHT_COLORS);
export type HighlightColor = z.infer<typeof HighlightColor>;

/** Default labels; a user can rename them (`user_settings.highlight_labels`). */
export const DEFAULT_HIGHLIGHT_LABELS = {
  key: "Key idea",
  definition: "Definition",
  example: "Example",
  memorize: "Memorize",
  confusing: "Confusing",
} as const satisfies Record<HighlightColor, string>;

export const ANCHOR_STATUSES = ["anchored", "reanchored", "orphaned"] as const;
export const AnchorStatus = z.enum(ANCHOR_STATUSES);
export type AnchorStatus = z.infer<typeof AnchorStatus>;

/** Length of `quote.prefix` and `quote.suffix`, in UTF-16 code units. */
export const QUOTE_CONTEXT_LENGTH = 32;
