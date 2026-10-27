/**
 * ReaderEngine: the only way the app touches a PDF engine (CLAUDE.md principle 3).
 * ADR-0003 chose PDF.js (`pdfjs-dist`); `pdfjs-engine.ts` is the adapter. Nothing outside that file
 * may import `pdfjs-dist`.
 *
 * Coordinates everywhere: PDF points, page CropBox, UNROTATED, origin top-left (ARCHITECTURE §4).
 * Page indexes are 0-based.
 */
import type { Rect } from "@margin/annotation-model";

export type Rotation = 0 | 90 | 180 | 270;

/** Size of a page's CropBox in points (unrotated) and the page's own /Rotate. */
export interface PageGeometry {
  width: number;
  height: number;
  rotation: Rotation;
}

/** One text-drawing operation (a PDF.js text item), already in page coordinates. */
export interface TextRun {
  str: string;
  /** Left end of the baseline. */
  x: number;
  /** Baseline y (origin top-left). */
  y: number;
  /** Advance width in points along the baseline. */
  width: number;
  fontSize: number;
  /** Ascent and descent as fractions of the font size (descent is positive). */
  ascent: number;
  descent: number;
  /** Counter-clockwise degrees of the baseline, as in the PDF (0 for ordinary text). */
  angle: number;
  /** CSS font-family fallback for the text layer. */
  fontFamily: string;
  dir: "ltr" | "rtl";
  /** A line ends after this run. */
  hasEOL: boolean;
  /** Offset of `str` in `PageText.text`. */
  start: number;
}

/** `text` is the runs' strings joined, with "\n" after each run that ends a line. */
export interface PageText {
  text: string;
  runs: TextRun[];
}

export interface OutlineItem {
  title: string;
  /** 0-based page, undefined for items that do not point inside the document. */
  page?: number;
  /** Distance from the top of the page in points, when the destination has one. */
  offsetPt?: number;
  children: OutlineItem[];
}

/** A search hit: offsets into `PageText.text` of that page. */
export interface SearchHit {
  page: number;
  start: number;
  end: number;
}

export type PasswordReason = "need" | "incorrect";

export interface OpenOptions {
  /**
   * Called when the file is encrypted. Resolve with the password (kept in memory only, never
   * stored) or null to cancel. Called again with "incorrect" after a wrong answer.
   */
  requestPassword?: (reason: PasswordReason) => Promise<string | null>;
  /** Where the engine's static assets (worker, fonts, cmaps) are served. Default "/pdfjs/". */
  assetBaseUrl?: string;
  signal?: AbortSignal;
}

export type ReaderErrorCode = "password-cancelled" | "corrupted" | "network" | "unknown";

/** Everything `open` throws. `message` is friendly; `details` is the engine's own message. */
export class ReaderError extends Error {
  readonly code: ReaderErrorCode;
  readonly details: string;
  constructor(code: ReaderErrorCode, message: string, details = "") {
    super(message);
    this.name = "ReaderError";
    this.code = code;
    this.details = details;
  }
}

export interface RenderOptions {
  /** CSS pixels per point (zoom 1 = 1 CSS px per pt). */
  scale: number;
  /** Extra backing-store multiplier, normally devicePixelRatio. */
  pixelRatio: number;
  /** Aborting cancels the render; the promise rejects with an AbortError. */
  signal?: AbortSignal;
}

export interface ReaderDocument {
  readonly pageCount: number;
  /** "sha256:<hex>" of the file bytes: the annotation target fingerprint. */
  fingerprint(): Promise<string>;
  /** Cached; may take a round trip to the worker the first time. */
  pageGeometry(page: number): Promise<PageGeometry>;
  /** Draws the page onto `canvas`, sizing its backing store. No annotations, no scripts. */
  renderPage(page: number, canvas: HTMLCanvasElement, opts: RenderOptions): Promise<void>;
  /** Text runs with exact page-space geometry. Cached. */
  pageText(page: number): Promise<PageText>;
  /** Case- and diacritic-insensitive; hits arrive page by page, in reading order. */
  search(query: string, signal?: AbortSignal): AsyncIterable<SearchHit>;
  outline(): Promise<OutlineItem[]>;
  title(): Promise<string | undefined>;
  /** Frees the memory the engine holds for a page that scrolled far away. */
  releasePage(page: number): void;
  destroy(): Promise<void>;
}

export interface ReaderEngine {
  /** The URL form is fetched whole (no range loading yet). */
  open(source: ArrayBuffer | Uint8Array | string, opts?: OpenOptions): Promise<ReaderDocument>;
}

/** Position in a document: the page at the top of the viewport and how far into it. */
export interface ReaderPosition {
  page: number;
  offsetPt: number;
  zoom: ZoomSpec;
}

export type ZoomSpec = "fit-width" | "fit-page" | number;

export type { Rect };
