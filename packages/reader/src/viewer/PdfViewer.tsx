"use client";

import {
  type AnnotationTarget,
  buildQuote,
  HighlightTarget,
  mergeLineRects,
  pageToViewport,
  type Rect,
} from "@margin/annotation-model";
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type OutlineItem,
  type PageGeometry,
  type PasswordReason,
  type ReaderDocument,
  type ReaderEngine,
  ReaderError,
  type ReaderPosition,
  type ZoomSpec,
} from "../engine";
import { pdfJsEngine } from "../pdfjs-engine";
import { canvasMeasure, rangeBoxes } from "../text";
import { flattenOutline } from "./outline-utils";
import { type OverlayContext, PageSlot, rotatedSize } from "./PageSlot";

/** Zoom 100% is the CSS-physical size: 96 CSS px per inch over 72 points per inch. */
export const CSS_UNITS = 96 / 72;
export const MIN_ZOOM = 50;
export const MAX_ZOOM = 400;
export const ZOOM_STEPS = [50, 67, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400];

const PAD = 16;
const GAP = 12;
const RENDER_MARGIN = 2;
const POSITION_DEBOUNCE_MS = 300;
const DEFAULT_GEOMETRY: PageGeometry = { width: 612, height: 792, rotation: 0 };

export interface FindState {
  query: string;
  total: number;
  /** 0-based index of the current hit, -1 when there is none. */
  current: number;
  searching: boolean;
}

export interface ViewerState {
  /** 0-based page at the middle of the upper third of the viewport. */
  page: number;
  pageCount: number;
  zoom: ZoomSpec;
  /** Effective zoom in percent (100 = CSS-physical size). */
  percent: number;
  find: FindState;
}

export type ShortcutName = "find" | "goto" | "theme" | "help";

export interface PdfViewerHandle {
  goToPage: (page: number, offsetPt?: number) => void;
  /** Scrolls so a rect (page points, unrotated) sits a little below the top, whatever the rotation. */
  goToRect: (page: number, rect: Rect) => void;
  setZoom: (zoom: ZoomSpec) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  find: (query: string) => void;
  findNext: () => void;
  findPrev: () => void;
  clearFind: () => void;
  nextChapter: () => void;
  prevChapter: () => void;
  focus: () => void;
}

export interface PdfViewerProps {
  source: ArrayBuffer | Uint8Array | string;
  engine?: ReaderEngine;
  assetBaseUrl?: string;
  initialPosition?: ReaderPosition;
  onPositionChange?: (position: ReaderPosition) => void;
  onStateChange?: (state: ViewerState) => void;
  /** Emits an AnnotationTarget (kind highlight) for the text selection, or null when cleared. */
  onSelection?: (target: AnnotationTarget | null) => void;
  onDocumentLoad?: (doc: ReaderDocument, outline: OutlineItem[]) => void;
  onError?: (error: ReaderError) => void;
  /** Milliseconds from open to the first painted page. */
  onFirstPage?: (ms: number) => void;
  /** Keys the viewer does not own; the host decides what they do. */
  onShortcut?: (name: ShortcutName) => void;
  /** Per-page overlay slot for annotations (P09). Rendered above the canvas, below the text. */
  renderPageOverlay?: (ctx: OverlayContext) => ReactNode;
  /** Dark theme: invert the page instead of only dimming it. */
  invertInDark?: boolean;
  className?: string;
  ref?: Ref<PdfViewerHandle>;
}

type Status =
  | { kind: "loading" }
  | { kind: "password"; reason: PasswordReason }
  | { kind: "ready"; doc: ReaderDocument }
  | { kind: "error"; error: ReaderError };

type Anchor = { page: number; offsetPt: number; dy: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export function PdfViewer({
  source,
  engine = pdfJsEngine,
  assetBaseUrl,
  initialPosition,
  onPositionChange,
  onStateChange,
  onSelection,
  onDocumentLoad,
  onError,
  onFirstPage,
  onShortcut,
  renderPageOverlay,
  invertInDark,
  className,
  ref,
}: PdfViewerProps) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoomState] = useState<ZoomSpec>(initialPosition?.zoom ?? "fit-width");
  const [geoms, setGeoms] = useState<PageGeometry[]>([]);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [page, setPage] = useState(0);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [find, setFind] = useState<FindState>({
    query: "",
    total: 0,
    current: -1,
    searching: false,
  });
  const [hits, setHits] = useState<{ page: number; start: number; end: number }[]>([]);

  const anchor = useRef<Anchor>({
    page: initialPosition?.page ?? 0,
    offsetPt: initialPosition?.offsetPt ?? 0,
    dy: 0,
  });
  const passwordResolver = useRef<((password: string | null) => void) | null>(null);
  const openedAt = useRef(0);
  const firstPaint = useRef(false);
  const callbacks = useRef({
    onPositionChange,
    onStateChange,
    onSelection,
    onFirstPage,
    onShortcut,
  });
  callbacks.current = { onPositionChange, onStateChange, onSelection, onFirstPage, onShortcut };
  const findAbort = useRef<AbortController | null>(null);
  const hitsRef = useRef(hits);
  hitsRef.current = hits;

  const doc = status.kind === "ready" ? status.doc : null;
  const pageCount = doc?.pageCount ?? 0;

  // Open the document.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reopen only when the source changes
  useEffect(() => {
    const controller = new AbortController();
    let opened: ReaderDocument | null = null;
    openedAt.current = performance.now();
    firstPaint.current = false;
    setStatus({ kind: "loading" });
    setGeoms([]);
    setHits([]);
    setFind({ query: "", total: 0, current: -1, searching: false });
    engine
      .open(source, {
        assetBaseUrl,
        signal: controller.signal,
        requestPassword: (reason) =>
          new Promise((resolve) => {
            passwordResolver.current = resolve;
            setStatus({ kind: "password", reason });
          }),
      })
      .then(async (d) => {
        if (controller.signal.aborted) {
          void d.destroy();
          return;
        }
        opened = d;
        const first = await d.pageGeometry(0);
        if (controller.signal.aborted) return;
        setGeoms([first]);
        setStatus({ kind: "ready", doc: d });
        const items = await d.outline().catch(() => []);
        if (controller.signal.aborted) return;
        setOutline(items);
        onDocumentLoad?.(d, items);
        // Remaining page sizes, in the background, so every page is laid out before it is reached.
        const all: PageGeometry[] = [first];
        for (let start = 1; start < d.pageCount; start += 40) {
          const end = Math.min(start + 40, d.pageCount);
          const chunk = await Promise.all(
            Array.from({ length: end - start }, (_, k) =>
              d.pageGeometry(start + k).catch(() => first),
            ),
          );
          if (controller.signal.aborted) return;
          all.push(...chunk);
          setGeoms(all.slice());
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const e =
          error instanceof ReaderError
            ? error
            : new ReaderError(
                "unknown",
                "Something went wrong while opening this file.",
                String(error),
              );
        setStatus({ kind: "error", error: e });
        onError?.(e);
      });
    return () => {
      controller.abort();
      passwordResolver.current?.(null);
      passwordResolver.current = null;
      void opened?.destroy();
    };
  }, [source, engine, assetBaseUrl]);

  // Track the scroll container size.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: el.clientWidth, height: el.clientHeight }),
    );
    observer.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  const geomOf = useCallback(
    (i: number): PageGeometry => geoms[i] ?? geoms[0] ?? DEFAULT_GEOMETRY,
    [geoms],
  );

  const scale = useMemo(() => {
    if (!size.width) return 1;
    if (typeof zoom === "number") return (zoom / 100) * CSS_UNITS;
    const ref = rotatedSize(geomOf(0));
    const byWidth = (size.width - 2 * PAD) / ref.width;
    if (zoom === "fit-width") return byWidth;
    return Math.min(byWidth, (size.height - 2 * PAD) / ref.height);
  }, [zoom, size, geomOf]);

  const layout = useMemo(() => {
    const tops = new Float64Array(pageCount + 1);
    let y = PAD;
    let maxW = 0;
    for (let i = 0; i < pageCount; i++) {
      tops[i] = y;
      const r = rotatedSize(geomOf(i));
      y += r.height * scale + GAP;
      maxW = Math.max(maxW, r.width * scale);
    }
    tops[pageCount] = y - GAP + PAD;
    return {
      tops,
      height: tops[pageCount] as number,
      contentWidth: Math.max(size.width, maxW + 2 * PAD),
      maxW,
    };
  }, [pageCount, geomOf, scale, size.width]);

  const pageAt = useCallback(
    (y: number) => {
      const tops = layout.tops;
      let lo = 0;
      let hi = Math.max(pageCount - 1, 0);
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((tops[mid] as number) <= y) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
    [layout, pageCount],
  );

  const updateRange = useCallback(() => {
    const el = scroller.current;
    if (!el || !pageCount) return;
    const first = pageAt(el.scrollTop);
    const last = pageAt(el.scrollTop + el.clientHeight);
    const next: [number, number] = [
      Math.max(0, first - RENDER_MARGIN),
      Math.min(pageCount - 1, last + RENDER_MARGIN),
    ];
    setRange((prev) => (prev[0] === next[0] && prev[1] === next[1] ? prev : next));
    const probe = pageAt(el.scrollTop + el.clientHeight * 0.3);
    setPage((prev) => (prev === probe ? prev : probe));
  }, [pageAt, pageCount]);

  // Keep the reading position when the layout changes (zoom, resize, late page sizes).
  const lastContentWidth = useRef(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !pageCount) return;
    const a = anchor.current;
    const p = clamp(a.page, 0, pageCount - 1);
    const target = (layout.tops[p] as number) + a.offsetPt * scale - a.dy;
    el.scrollTop = clamp(target, 0, Math.max(0, layout.height - el.clientHeight));
    const prev = lastContentWidth.current;
    if (prev && prev !== layout.contentWidth) {
      el.scrollLeft =
        (el.scrollLeft + el.clientWidth / 2) * (layout.contentWidth / prev) - el.clientWidth / 2;
    }
    lastContentWidth.current = layout.contentWidth;
    updateRange();
  }, [layout, scale, pageCount, updateRange]);

  const positionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitPosition = useCallback(() => {
    if (positionTimer.current) clearTimeout(positionTimer.current);
    positionTimer.current = setTimeout(() => {
      callbacks.current.onPositionChange?.({
        page: anchor.current.page,
        offsetPt: Math.round(anchor.current.offsetPt * 100) / 100,
        zoom: zoomRef.current,
      });
    }, POSITION_DEBOUNCE_MS);
  }, []);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(
    () => () => {
      if (positionTimer.current) clearTimeout(positionTimer.current);
    },
    [],
  );

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el || !pageCount) return;
    const p = pageAt(el.scrollTop);
    anchor.current = {
      page: p,
      offsetPt: Math.max(0, (el.scrollTop - (layout.tops[p] as number)) / scale),
      dy: 0,
    };
    updateRange();
    emitPosition();
  }, [pageAt, layout, scale, updateRange, emitPosition, pageCount]);

  const percent = Math.round((scale / CSS_UNITS) * 100);

  // Report state to the host.
  useEffect(() => {
    callbacks.current.onStateChange?.({ page, pageCount, zoom, percent, find });
  }, [page, pageCount, zoom, percent, find]);

  // Zoom (anchored to the viewport top unless a pointer position is given).
  const applyZoom = useCallback(
    (next: ZoomSpec, pointerY?: number) => {
      const el = scroller.current;
      if (el && pageCount) {
        const y = el.scrollTop + (pointerY ?? 0);
        const p = pageAt(y);
        anchor.current = {
          page: p,
          offsetPt: Math.max(0, (y - (layout.tops[p] as number)) / scale),
          dy: pointerY ?? 0,
        };
      }
      setZoomState(typeof next === "number" ? clamp(next, MIN_ZOOM, MAX_ZOOM) : next);
      emitPosition();
    },
    [pageAt, layout, scale, pageCount, emitPosition],
  );

  const stepZoom = useCallback(
    (dir: 1 | -1) => {
      const now = percent;
      const next =
        dir > 0
          ? ZOOM_STEPS.find((s) => s > now + 0.5)
          : [...ZOOM_STEPS].reverse().find((s) => s < now - 0.5);
      applyZoom(next ?? (dir > 0 ? MAX_ZOOM : MIN_ZOOM));
    },
    [percent, applyZoom],
  );

  // Ctrl/cmd + wheel (also trackpad pinch) zooms around the pointer.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const next = clamp(percent * Math.exp(-event.deltaY * 0.002), MIN_ZOOM, MAX_ZOOM);
      applyZoom(Math.round(next * 10) / 10, event.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [percent, applyZoom]);

  // Two-finger pinch zooms around the midpoint. The latest percent and applyZoom live in refs so
  // the gesture survives the re-renders every zoom step causes.
  const pinchRef = useRef({ percent, applyZoom });
  pinchRef.current = { percent, applyZoom };
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let startDist = 0;
    let startPercent = 0;
    const dist = (e: TouchEvent) => {
      const a = e.touches[0];
      const b = e.touches[1];
      return a && b ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : 0;
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startDist = dist(e);
        startPercent = pinchRef.current.percent;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !startDist) return;
      e.preventDefault();
      const a = e.touches[0];
      const b = e.touches[1];
      if (!(a && b)) return;
      const next = clamp(startPercent * (dist(e) / startDist), MIN_ZOOM, MAX_ZOOM);
      const midY = (a.clientY + b.clientY) / 2 - el.getBoundingClientRect().top;
      pinchRef.current.applyZoom(Math.round(next * 10) / 10, midY);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) startDist = 0;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const goToPage = useCallback(
    (target: number, offsetPt = 0) => {
      const el = scroller.current;
      if (!el || !pageCount) return;
      const p = clamp(Math.round(target), 0, pageCount - 1);
      anchor.current = { page: p, offsetPt, dy: 0 };
      el.scrollTop = clamp(
        (layout.tops[p] as number) + offsetPt * scale - (offsetPt > 0 ? 24 : 0),
        0,
        Math.max(0, layout.height - el.clientHeight),
      );
    },
    [layout, scale, pageCount],
  );

  const goToRect = useCallback(
    (target: number, rect: Rect) => {
      const g = geomOf(clamp(Math.round(target), 0, Math.max(pageCount - 1, 0)));
      const top = pageToViewport(rect, {
        pageWidth: g.width,
        pageHeight: g.height,
        rotation: g.rotation,
        scale: 1,
      })[1];
      goToPage(target, Math.max(0, top - 80));
    },
    [geomOf, goToPage, pageCount],
  );

  const chapters = useMemo(() => flattenOutline(outline), [outline]);
  const jumpChapter = useCallback(
    (dir: 1 | -1) => {
      const cur = anchor.current.page;
      const pick =
        dir > 0
          ? chapters.find((c) => (c.page as number) > cur)
          : [...chapters].reverse().find((c) => (c.page as number) < cur);
      if (pick) goToPage(pick.page as number, pick.offsetPt ?? 0);
    },
    [chapters, goToPage],
  );

  // Find in document.
  const runFind = useCallback(
    async (query: string) => {
      findAbort.current?.abort();
      const trimmed = query.trim();
      setHits([]);
      if (!doc || !trimmed) {
        setFind({ query, total: 0, current: -1, searching: false });
        return;
      }
      const controller = new AbortController();
      findAbort.current = controller;
      setFind({ query, total: 0, current: -1, searching: true });
      const found: { page: number; start: number; end: number }[] = [];
      let lastFlush = 0;
      let jumped = false;
      const flush = (searching: boolean) => {
        setHits(found.slice());
        setFind((prev) => ({
          query,
          total: found.length,
          current: found.length && prev.current < 0 ? 0 : prev.current,
          searching,
        }));
      };
      for await (const hit of doc.search(trimmed, controller.signal)) {
        // A newer query (or Esc) aborted this search while a page was loading: drop its late hits.
        if (controller.signal.aborted) break;
        found.push(hit);
        if (!jumped) {
          jumped = true;
          void revealHit(doc, hit, goToPage);
        }
        const now = performance.now();
        if (now - lastFlush > 120) {
          lastFlush = now;
          flush(true);
        }
      }
      if (!controller.signal.aborted) flush(false);
    },
    [doc, goToPage],
  );

  const stepFind = useCallback(
    (dir: 1 | -1) => {
      if (!doc || !hitsRef.current.length) return;
      setFind((prev) => {
        const total = hitsRef.current.length;
        const next = (((prev.current + dir) % total) + total) % total;
        const hit = hitsRef.current[next];
        if (hit) void revealHit(doc, hit, goToPage);
        return { ...prev, current: next };
      });
    },
    [doc, goToPage],
  );

  useImperativeHandle(
    ref,
    () => ({
      goToPage,
      goToRect,
      setZoom: (z) => applyZoom(z),
      zoomIn: () => stepZoom(1),
      zoomOut: () => stepZoom(-1),
      find: (q) => void runFind(q),
      findNext: () => stepFind(1),
      findPrev: () => stepFind(-1),
      clearFind: () => void runFind(""),
      nextChapter: () => jumpChapter(1),
      prevChapter: () => jumpChapter(-1),
      focus: () => scroller.current?.focus(),
    }),
    [goToPage, goToRect, applyZoom, stepZoom, runFind, stepFind, jumpChapter],
  );

  // Keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.defaultPrevented) return;
      const el = scroller.current;
      if (!el) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key;
      const cur = anchor.current.page;
      const handled = () => event.preventDefault();
      if (mod) {
        if (key === "f") {
          handled();
          callbacks.current.onShortcut?.("find");
        } else if (key === "=" || key === "+") {
          handled();
          stepZoom(1);
        } else if (key === "-") {
          handled();
          stepZoom(-1);
        } else if (key === "0") {
          handled();
          applyZoom("fit-width");
        }
        return;
      }
      if (event.altKey) return;
      switch (key) {
        case "ArrowDown":
        case "j":
          handled();
          el.scrollBy({ top: 56 });
          break;
        case "ArrowUp":
        case "k":
          handled();
          el.scrollBy({ top: -56 });
          break;
        case " ":
          handled();
          el.scrollBy({ top: (event.shiftKey ? -1 : 1) * el.clientHeight * 0.9 });
          break;
        case "PageDown":
        case "ArrowRight":
          handled();
          goToPage(cur + 1);
          break;
        case "PageUp":
        case "ArrowLeft":
          handled();
          goToPage(cur - 1);
          break;
        case "Home":
          handled();
          goToPage(0);
          break;
        case "End":
          handled();
          goToPage(pageCount - 1);
          break;
        case "]":
          handled();
          jumpChapter(1);
          break;
        case "[":
          handled();
          jumpChapter(-1);
          break;
        case "/":
          handled();
          callbacks.current.onShortcut?.("find");
          break;
        case "g":
          handled();
          callbacks.current.onShortcut?.("goto");
          break;
        case "t":
          callbacks.current.onShortcut?.("theme");
          break;
        case "?":
          callbacks.current.onShortcut?.("help");
          break;
        case "+":
        case "=":
          handled();
          stepZoom(1);
          break;
        case "-":
          handled();
          stepZoom(-1);
          break;
        case "0":
          handled();
          applyZoom("fit-width");
          break;
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goToPage, stepZoom, applyZoom, jumpChapter, pageCount]);

  // Dragging a selection over blank space of a text layer would let the browser jump the caret to
  // the end of the layer's content (a whole column selected). While a drag that started on text is
  // running, an invisible "end of content" block sits right after the span holding the selection's
  // focus (before it when dragging backwards), so blank space never moves the end of the selection.
  useEffect(() => {
    const el = root.current;
    if (!(doc && el)) return;
    let selecting = false;
    const stop = () => {
      if (!selecting) return;
      selecting = false;
      el.classList.remove("mr-selecting");
    };
    const onDown = (event: MouseEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (!event.target.closest(".mr-textlayer > span")) return;
      selecting = true;
      el.classList.add("mr-selecting");
    };
    const onChange = () => {
      if (!selecting) return;
      const selection = document.getSelection();
      const focus = selection?.focusNode;
      if (!(selection && focus)) return;
      const host = focus instanceof Element ? focus : focus.parentElement;
      const span = host?.closest(".mr-textlayer > span");
      const end = span?.parentElement?.querySelector(":scope > .mr-end");
      if (!(span && end)) return;
      const anchor = selection.anchorNode;
      const forward =
        !anchor ||
        (anchor === focus
          ? selection.anchorOffset <= selection.focusOffset
          : Boolean(anchor.compareDocumentPosition(focus) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (forward) {
        if (span.nextElementSibling !== end && span.nextSibling !== end) span.after(end);
      } else if (span.previousSibling !== end) {
        span.before(end);
      }
    };
    // Over blank space the drag snaps to the line under (or nearest to) the pointer: to its end
    // when the pointer is right of the text, to its start when left of it.
    const onMove = (event: MouseEvent) => {
      if (!selecting || !(event.target instanceof Element)) return;
      if (!event.target.classList.contains("mr-end")) return;
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const { clientX: x, clientY: y } = event;
      let best: { node: Text; dx: number; dy: number; left: boolean } | null = null;
      for (const span of event.target.parentElement?.querySelectorAll(":scope > span") ?? []) {
        const node = span.firstChild;
        if (!(node instanceof Text)) continue;
        const r = span.getBoundingClientRect();
        const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        if (dy > r.height * 0.5) continue;
        const left = x < r.left;
        const dx = left ? r.left - x : x - r.right;
        if (dx < 0) continue;
        if (!best || dy < best.dy - 0.5 || (Math.abs(dy - best.dy) <= 0.5 && dx < best.dx)) {
          best = { node, dx, dy, left };
        }
      }
      if (best) selection.extend(best.node, best.left ? 0 : best.node.length);
    };
    el.addEventListener("mousedown", onDown, true);
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", stop, true);
    window.addEventListener("blur", stop);
    document.addEventListener("selectionchange", onChange);
    return () => {
      el.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", stop, true);
      window.removeEventListener("blur", stop);
      document.removeEventListener("selectionchange", onChange);
      stop();
    };
  }, [doc]);

  // Selection -> AnnotationTarget.
  useEffect(() => {
    if (!doc) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let seq = 0;
    let hadSelection = false;
    const emit = (target: AnnotationTarget | null) => {
      if (target === null && !hadSelection) return;
      hadSelection = target !== null;
      callbacks.current.onSelection?.(target);
    };
    const compute = async () => {
      const mine = ++seq;
      let target: AnnotationTarget | null = null;
      try {
        target = await selectionToTarget(root.current, doc);
      } catch (error) {
        console.error("Could not turn the selection into an annotation target", error);
      }
      if (mine === seq) emit(target);
    };
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void compute(), 120);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      if (timer) clearTimeout(timer);
    };
  }, [doc]);

  const hitsByPage = useMemo(() => {
    const map = new Map<number, { start: number; end: number; current: boolean }[]>();
    hits.forEach((hit, i) => {
      const list = map.get(hit.page) ?? [];
      list.push({ start: hit.start, end: hit.end, current: i === find.current });
      map.set(hit.page, list);
    });
    return map;
  }, [hits, find.current]);

  const onPainted = useCallback(() => {
    if (firstPaint.current) return;
    firstPaint.current = true;
    const ms = performance.now() - openedAt.current;
    root.current?.setAttribute("data-first-page-ms", ms.toFixed(1));
    callbacks.current.onFirstPage?.(ms);
  }, []);

  const submitPassword = (password: string | null) => {
    const resolve = passwordResolver.current;
    passwordResolver.current = null;
    resolve?.(password);
    if (password === null) setStatus({ kind: "loading" });
  };

  const pages: ReactNode[] = [];
  if (doc) {
    for (let i = range[0]; i <= Math.min(range[1], pageCount - 1); i++) {
      const g = geomOf(i);
      const r = rotatedSize(g);
      pages.push(
        <PageSlot
          key={i}
          doc={doc}
          index={i}
          geometry={g}
          scale={scale}
          top={layout.tops[i] as number}
          left={(layout.contentWidth - r.width * scale) / 2}
          hits={hitsByPage.get(i)}
          renderOverlay={renderPageOverlay}
          onPainted={onPainted}
        />,
      );
    }
  }

  return (
    <div
      ref={root}
      className={`mr-viewer ${className ?? ""}`}
      data-status={status.kind}
      data-page-count={pageCount || undefined}
      data-current-page={page}
      data-zoom-percent={percent}
      data-invert={invertInDark ? "true" : undefined}
    >
      <section
        className="mr-scroller"
        ref={scroller}
        onScroll={onScroll}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable for keyboard scrolling
        tabIndex={0}
        aria-label="Document pages"
      >
        <div className="mr-pages" style={{ width: layout.contentWidth, height: layout.height }}>
          {pages}
        </div>
      </section>
      {status.kind === "loading" ? (
        <div className="mr-status" role="status">
          Opening…
        </div>
      ) : null}
      {status.kind === "password" ? (
        <PasswordPrompt reason={status.reason} onSubmit={submitPassword} />
      ) : null}
      {status.kind === "error" ? (
        <div className="mr-status mr-error" role="alert" data-testid="reader-error">
          <strong>{status.error.message}</strong>
          {status.error.details ? (
            <details>
              <summary>Details</summary>
              {status.error.details}
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PasswordPrompt({
  reason,
  onSubmit,
}: {
  reason: PasswordReason;
  onSubmit: (password: string | null) => void;
}) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // The prompt is the only thing the user can act on, so it takes focus (also after a wrong try).
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus whenever the reason changes
  useEffect(() => input.current?.focus(), [reason]);
  return (
    <form
      className="mr-status mr-password"
      data-testid="password-prompt"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
        setValue("");
      }}
    >
      <label htmlFor="mr-password-input">
        {reason === "incorrect"
          ? "That password didn't work. Try again."
          : "This PDF is password protected."}
      </label>
      <input
        id="mr-password-input"
        type="password"
        autoComplete="off"
        ref={input}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="mr-password-actions">
        <button type="submit">Unlock</button>
        <button type="button" onClick={() => onSubmit(null)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

async function revealHit(
  doc: ReaderDocument,
  hit: { page: number; start: number; end: number },
  goToPage: (page: number, offsetPt?: number) => void,
) {
  const text = await doc.pageText(hit.page);
  const rects = rangeBoxes(text, hit.start, hit.end, canvasMeasure);
  const top = rects[0]?.[1] ?? 0;
  goToPage(hit.page, Math.max(0, top - 80));
}

interface Covered {
  page: number;
  run: number;
  from: number;
  to: number;
}

/** Turns the browser selection inside `root` into a highlight target, or null. */
export async function selectionToTarget(
  root: HTMLElement | null,
  doc: ReaderDocument,
): Promise<AnnotationTarget | null> {
  const selection = document.getSelection();
  if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const covered: Covered[] = [];
  for (const span of root.querySelectorAll<HTMLElement>(".mr-textlayer > span")) {
    const node = span.firstChild;
    if (!(node instanceof Text)) continue;
    // Compare the boundary points with the text node itself. A range that ends at (span, 0) or
    // (layer, i) (triple click, drag past the line end) touches the next span without selecting
    // anything of it, and must not pull that span in.
    const len = node.length;
    if (range.comparePoint(node, len) < 0 || range.comparePoint(node, 0) > 0) continue;
    const from = range.startContainer === node ? range.startOffset : 0;
    const to = range.endContainer === node ? range.endOffset : len;
    if (to > from)
      covered.push({ page: Number(span.dataset.page), run: Number(span.dataset.run), from, to });
  }
  const first = covered[0];
  const last = covered.at(-1);
  if (!first || !last) return null;

  const [startPage, endPage] = [first.page, last.page];
  const startRun = (await doc.pageText(startPage)).runs[first.run];
  const endRun = (await doc.pageText(endPage)).runs[last.run];
  if (!startRun || !endRun) return null;
  const startOffset = startRun.start + first.from;
  const endOffset = endRun.start + last.to;

  const segments: { page: number; rects: Rect[]; textPos: { start: number; end: number } }[] = [];
  const pieces: { text: string; from: number; to: number }[] = [];
  for (let p = startPage; p <= endPage; p++) {
    const pageText = await doc.pageText(p);
    let from = p === startPage ? startOffset : 0;
    let to = p === endPage ? endOffset : pageText.text.length;
    while (from < to && /\s/.test(pageText.text[from] as string)) from++;
    while (to > from && /\s/.test(pageText.text[to - 1] as string)) to--;
    if (to <= from) continue;
    const rects = mergeLineRects(rangeBoxes(pageText, from, to, canvasMeasure)).map(
      (r) => r.map((v) => Math.round(v * 1000) / 1000) as Rect,
    );
    if (!rects.length) continue;
    segments.push({ page: p, rects, textPos: { start: from, end: to } });
    pieces.push({ text: pageText.text, from, to });
  }
  const firstSegment = segments[0];
  const lastPiece = pieces.at(-1);
  const firstPiece = pieces[0];
  if (!firstSegment || !lastPiece || !firstPiece) return null;

  const combined = pieces.map((piece) => piece.text).join("\n");
  const lastBase = combined.length - lastPiece.text.length;
  const quote = buildQuote(combined, firstPiece.from, lastBase + lastPiece.to);
  const parsed = HighlightTarget.safeParse({
    fingerprint: await doc.fingerprint(),
    segments,
    quote,
  });
  if (!parsed.success) {
    console.warn("Selection does not form a valid highlight target", parsed.error.message);
    return null;
  }
  return parsed.data;
}
