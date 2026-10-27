/**
 * @margin/annotation-model: annotation types, zod schemas and coordinate transforms
 * (Contract: docs/ARCHITECTURE.md §4, docs/adr/0001-annotation-model.md).
 * Pure TypeScript; zod is the only runtime dependency.
 */
export { buildQuote } from "./quote";
export {
  AnnotationShape,
  AnnotationTarget,
  AreaTarget,
  BookmarkTarget,
  Fingerprint,
  HighlightTarget,
  PageIndex,
  pageStart,
  Quote,
  Rect,
  TextPos,
} from "./target";
export {
  mergeLineRects,
  type PageView,
  pageToViewport,
  type Rotation,
  viewportToPage,
} from "./transforms";
export {
  ANCHOR_STATUSES,
  ANNOTATION_KINDS,
  AnchorStatus,
  AnnotationKind,
  DEFAULT_HIGHLIGHT_LABELS,
  HIGHLIGHT_COLORS,
  HighlightColor,
  QUOTE_CONTEXT_LENGTH,
} from "./vocabulary";
