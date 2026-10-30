/**
 * @margin/reader: the ReaderEngine interface (ADR-0003), the PDF.js adapter and the React viewer.
 * Import "@margin/reader/viewer.css" once in the app.
 */
export { bodyFontSize, type DeriveOptions, deriveChapters, deriveOutline } from "./derive-outline";
export * from "./engine";
export { pdfJsEngine } from "./pdfjs-engine";
export {
  buildPageText,
  canvasMeasure,
  findInText,
  type Measure,
  normalizeForSearch,
  pageTextFromContent,
  type RawTextContent,
  rangeBoxes,
  runPartRect,
  runRect,
} from "./text";
export { Outline, type OutlineProps } from "./viewer/Outline";
export { currentChapter, flattenOutline } from "./viewer/outline-utils";
export type { OverlayContext } from "./viewer/PageSlot";
export {
  CSS_UNITS,
  type FindState,
  MAX_ZOOM,
  MIN_ZOOM,
  PdfViewer,
  type PdfViewerHandle,
  type PdfViewerProps,
  type ShortcutName,
  type ViewerState,
  ZOOM_STEPS,
} from "./viewer/PdfViewer";
export { Thumbnails, type ThumbnailsProps } from "./viewer/Thumbnails";
