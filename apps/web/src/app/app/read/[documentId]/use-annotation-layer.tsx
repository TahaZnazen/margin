"use client";

import {
  AnnotationShape,
  type AnnotationTarget,
  DEFAULT_HIGHLIGHT_LABELS,
  type HighlightColor,
  type HighlightTarget,
} from "@margin/annotation-model";
import type { OverlayContext, PdfViewerHandle } from "@margin/reader";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Annotation } from "@/lib/annotations/annotations-repo";
import { annotationStoreFor } from "@/lib/annotations/store";
import { services } from "@/lib/documents/services";
import { uuidv7 } from "@/lib/uuid";
import { markCreate, PageAnnotations } from "./annotation-overlay";
import { AnnotationPopover } from "./annotation-popover";

const COLORS: HighlightColor[] = ["key", "definition", "example", "memorize", "confusing"];
const FLASH_MS = 1500;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export interface AnnotationLayerArgs {
  documentId: string;
  title: string;
  sha256: string;
  labels: Partial<Record<HighlightColor, string>>;
  viewer: RefObject<PdfViewerHandle | null>;
  wrapper: RefObject<HTMLElement | null>;
  /** 0-based page at the top of the viewport, and whether the document is laid out. */
  page: number;
  ready: boolean;
}

export function useAnnotationLayer(args: AnnotationLayerArgs) {
  const { documentId, title, sha256, viewer, wrapper, page, ready } = args;
  const store = useMemo(() => annotationStoreFor(services().annotations, documentId), [documentId]);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [selection, setSelection] = useState<HighlightTarget | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const requestFocus = useCallback(
    (id: string) => setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 })),
    [],
  );
  useEffect(() => setFocus((f) => (f && f.id === activeId ? f : null)), [activeId]);
  const [flash, setFlash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const labels = useMemo(
    () => ({ ...DEFAULT_HIGHLIGHT_LABELS, ...args.labels }) as Record<HighlightColor, string>,
    [args.labels],
  );

  useEffect(() => {
    store.load().catch((error) => console.error("Could not load annotations", error));
    const onHide = () => void store.flush();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [store]);

  const active = useMemo(
    () => snap.items.find((item) => item.id === activeId && item.kind === "highlight") ?? null,
    [snap.items, activeId],
  );

  const byPage = useMemo(() => {
    const map = new Map<number, Annotation[]>();
    for (const item of snap.items) {
      const pages = new Set(item.target.segments.map((s) => s.page));
      for (const p of pages) map.set(p, [...(map.get(p) ?? []), item]);
    }
    return map;
  }, [snap.items]);

  const renderPageOverlay = useCallback(
    (ctx: OverlayContext): ReactNode => {
      const items = byPage.get(ctx.page);
      if (!items) return null;
      return <PageAnnotations ctx={ctx} items={items} flashId={flash} activeId={activeId} />;
    },
    [byPage, flash, activeId],
  );

  const jumpTo = useCallback(
    (id: string) => {
      const a = store.get(id);
      if (!a) return;
      const rect = a.target.segments[0].rects[0];
      if (rect) viewer.current?.goToRect(a.pageStart, rect);
      else viewer.current?.goToPage(a.pageStart);
      clearTimeout(flashTimer.current);
      setFlash(null);
      requestAnimationFrame(() => {
        setFlash(id);
        flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
      });
    },
    [store, viewer],
  );

  // Deep link: /app/read/<id>#a=<annotationId>.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!(ready && snap.loaded)) return;
    const apply = () => {
      const id = /[#&]a=([0-9a-f-]{36})/.exec(window.location.hash)?.[1];
      if (!id || handled.current === id) return;
      if (!store.get(id)) return;
      handled.current = id;
      jumpTo(id);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [ready, snap.loaded, store, jumpTo]);

  const clearSelection = useCallback(() => {
    document.getSelection()?.removeAllRanges();
    setSelection(null);
  }, []);

  const createHighlight = useCallback(
    (color: HighlightColor): Annotation | null => {
      if (!selection) return null;
      const target = selection;
      const parsed = AnnotationShape.safeParse({
        kind: "highlight",
        color,
        target,
        quote_text: target.quote.exact,
        page_start: target.segments[0].page,
      });
      if (!parsed.success) {
        console.warn("Invalid highlight", parsed.error.message);
        return null;
      }
      const now = new Date().toISOString();
      const annotation: Annotation = {
        id: uuidv7(),
        documentId,
        kind: "highlight",
        color,
        target,
        pageStart: target.segments[0].page,
        quoteText: target.quote.exact,
        comment: null,
        anchorStatus: "anchored",
        createdAt: now,
        updatedAt: now,
      };
      markCreate(annotation.id);
      store.create(annotation);
      clearSelection();
      return annotation;
    },
    [selection, documentId, store, clearSelection],
  );

  const toggleBookmark = useCallback(() => {
    const existing = snap.items.find((i) => i.kind === "bookmark" && i.pageStart === page);
    if (existing) {
      store.remove(existing.id);
      return;
    }
    const target = { fingerprint: `sha256:${sha256}`, segments: [{ page, rects: [] }] };
    const parsed = AnnotationShape.safeParse({
      kind: "bookmark",
      target,
      quote_text: null,
      page_start: page,
    });
    if (!parsed.success) return;
    const now = new Date().toISOString();
    const annotation: Annotation = {
      id: uuidv7(),
      documentId,
      kind: "bookmark",
      color: null,
      target: parsed.data.target as AnnotationTarget,
      pageStart: page,
      quoteText: null,
      comment: null,
      anchorStatus: "anchored",
      createdAt: now,
      updatedAt: now,
    };
    store.create(annotation);
  }, [snap.items, page, sha256, documentId, store]);

  const copyCitation = useCallback(
    (a: { quote: string; page: number }) => {
      const text = `"${a.quote}" — ${title}, p. ${a.page + 1}`;
      void navigator.clipboard?.writeText(text).catch(() => undefined);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    },
    [title],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      const list = snap.items.filter((i) => i.kind === "highlight");
      if (!list.length) return;
      const at = list.findIndex((i) => i.id === activeId);
      const next = list[(at + dir + list.length) % list.length];
      if (!next) return;
      setActiveId(next.id);
      jumpTo(next.id);
    },
    [snap.items, activeId, jumpTo],
  );

  // Keys. Runs in the capture phase so it wins over the viewer's own j/k scrolling.
  const latest = useRef({ selection, active, snap });
  latest.current = { selection, active, snap };
  const actions = useRef({
    createHighlight,
    toggleBookmark,
    copyCitation,
    step,
    clearSelection,
  });
  actions.current = { createHighlight, toggleBookmark, copyCitation, step, clearSelection };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { selection: sel, active: act } = latest.current;
      const a = actions.current;
      const consume = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      const key = event.key;
      if (isTyping(event.target)) {
        if (key === "Escape" && act) {
          (event.target as HTMLElement).blur();
          setActiveId(null);
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "z") {
        consume();
        const touched = event.shiftKey ? store.redo() : store.undo();
        if (touched) setActiveId(null);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (key >= "1" && key <= "5") {
        const color = COLORS[Number(key) - 1];
        if (!color) return;
        if (sel) {
          consume();
          a.createHighlight(color);
        } else if (act) {
          consume();
          store.update(act.id, { color });
        }
      } else if (key === "n" || key === "N") {
        if (sel) {
          consume();
          const created = a.createHighlight("key");
          if (created) {
            setActiveId(created.id);
            requestFocus(created.id);
          }
        } else if (act) {
          consume();
          requestFocus(act.id);
        }
      } else if (key === "C" && event.shiftKey) {
        const quote = sel?.quote.exact ?? act?.quoteText;
        const pageIndex = sel?.segments[0].page ?? act?.pageStart;
        if (quote && pageIndex !== undefined) {
          consume();
          a.copyCitation({ quote, page: pageIndex });
        }
      } else if ((key === "Delete" || key === "Backspace") && act) {
        consume();
        store.remove(act.id);
        setActiveId(null);
      } else if ((key === "j" || key === "k" || key === "J" || key === "K") && act) {
        consume();
        a.step(key.toLowerCase() === "j" ? 1 : -1);
      } else if (key === "b" || key === "B") {
        consume();
        a.toggleBookmark();
      } else if (key === "Escape") {
        if (act) setActiveId(null);
        else if (sel) a.clearSelection();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [store, requestFocus]);

  const onSelection = useCallback((target: AnnotationTarget | null) => {
    if (target && "quote" in target) {
      setSelection(target);
      setActiveId(null);
    } else setSelection(null);
  }, []);

  // Click on a highlight: the text layer sits above the overlay, so hit-test the rects by hand.
  const onClick = useCallback(
    (event: React.MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("[data-annot-popover]")) return;
      if (document.getSelection()?.isCollapsed === false) return;
      const root = wrapper.current;
      if (!root) return;
      let best: { id: string; area: number } | null = null;
      for (const el of root.querySelectorAll<HTMLElement>(".mr-annot")) {
        const r = el.getBoundingClientRect();
        if (
          event.clientX >= r.left &&
          event.clientX <= r.right &&
          event.clientY >= r.top &&
          event.clientY <= r.bottom
        ) {
          const area = r.width * r.height;
          if (!best || area < best.area) best = { id: el.dataset.annotationId ?? "", area };
        }
      }
      setActiveId(best?.id || null);
    },
    [wrapper],
  );

  const selectionAnchor = useCallback(() => {
    const range = document.getSelection()?.rangeCount
      ? document.getSelection()?.getRangeAt(0)
      : null;
    const rects = range ? [...range.getClientRects()] : [];
    const last = rects.at(-1);
    const first = rects[0];
    if (!(first && last)) return null;
    return new DOMRect(
      first.left,
      first.top,
      Math.max(1, last.right - first.left),
      last.bottom - first.top,
    );
  }, []);

  const activeAnchor = useCallback(() => {
    if (!activeId) return null;
    const el = wrapper.current?.querySelector<HTMLElement>(
      `.mr-annot[data-annotation-id="${activeId}"]`,
    );
    return el ? el.getBoundingClientRect() : null;
  }, [activeId, wrapper]);

  let popover: ReactNode = null;
  if (active) {
    popover = (
      <AnnotationPopover
        key={active.id}
        mode="edit"
        anchor={activeAnchor}
        labels={labels}
        color={active.color}
        comment={active.comment ?? ""}
        focusNonce={focus?.id === active.id ? focus.n : 0}
        copied={copied}
        onColor={(color) => store.update(active.id, { color })}
        onNote={() => requestFocus(active.id)}
        onCopy={() =>
          active.quoteText && copyCitation({ quote: active.quoteText, page: active.pageStart })
        }
        onDelete={() => {
          store.remove(active.id);
          setActiveId(null);
        }}
        onComment={(text) =>
          store.update(active.id, { comment: text.trim() ? text : null }, `comment:${active.id}`)
        }
      />
    );
  } else if (selection) {
    popover = (
      <AnnotationPopover
        mode="create"
        anchor={selectionAnchor}
        labels={labels}
        color={null}
        comment=""
        focusNonce={0}
        copied={copied}
        onColor={(color) => createHighlight(color)}
        onNote={() => {
          const created = createHighlight("key");
          if (created) {
            setActiveId(created.id);
            requestFocus(created.id);
          }
        }}
        onCopy={() =>
          copyCitation({ quote: selection.quote.exact, page: selection.segments[0].page })
        }
        onDelete={() => undefined}
        onComment={() => undefined}
      />
    );
  }

  const bookmarks = snap.items.filter((i) => i.kind === "bookmark");

  return {
    renderPageOverlay,
    onSelection,
    onClick,
    popover,
    jumpTo,
    bookmarks,
    snap,
    toggleBookmark,
  };
}
