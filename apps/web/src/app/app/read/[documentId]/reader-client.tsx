"use client";

import "@margin/reader/viewer.css";
import "./annotations.css";
import { DEFAULT_HIGHLIGHT_LABELS, type HighlightColor } from "@margin/annotation-model";
import {
  deriveOutline,
  type OutlineItem,
  PdfViewer,
  type PdfViewerHandle,
  type ReaderDocument,
  type ReaderError,
  type ReaderPosition,
  type ViewerState,
} from "@margin/reader";
import { useUnsyncedWrites } from "@margin/sync/client";
import { Button } from "@margin/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@margin/ui/components/dropdown-menu";
import { Progress } from "@margin/ui/components/progress";
import { Sheet, SheetContent, SheetTitle } from "@margin/ui/components/sheet";
import { toast } from "@margin/ui/components/sonner";
import { ThemeSwitch } from "@margin/ui/components/theme-switch";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookmarkIcon,
  DownloadIcon,
  PanelLeftIcon,
  PanelRightIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QuoteHost } from "@/components/notes/note-editor";
import { SyncStatus } from "@/components/sync-status";
import type { Book, ReadingState } from "@/lib/documents/documents-repo";
import { opfsRead, opfsWrite } from "@/lib/documents/opfs";
import { services } from "@/lib/documents/services";
import { exportBookMarkdown, exportBookPdf } from "@/lib/export/client";
import { useNotebook } from "@/lib/notes/use-notebook";
import {
  chapterIndexAt,
  chapterLevel,
  chapterProgress,
  flatChapters,
  nextChapterAtEnd,
  pageFromHash,
} from "@/lib/reader/chapters";
import { ReaderSidebar, SIDEBAR_TABS, type SidebarTab } from "./reader-sidebar";
import { SidePanel } from "./side-panel";
import { useAnnotationLayer } from "./use-annotation-layer";
import { useImportExisting } from "./use-import";

const SAVE_DEBOUNCE_MS = 1000;
const ACTIVE_WINDOW_MS = 30_000;
const SECONDS_FLUSH_EVERY = 15;

type Phase =
  | { kind: "loading"; progress: number | null }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      book: Book;
      bytes: ArrayBuffer;
      initial: ReaderPosition;
      seconds: number;
      labels: Partial<Record<HighlightColor, string>>;
    };

async function download(url: string, onProgress: (fraction: number | null) => void) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error("The download failed.");
  const total = Number(res.headers.get("content-length")) || 0;
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(total ? received / total : null);
  }
  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}

export function ReaderClient() {
  const { documentId } = useParams<{ documentId: string }>();
  const [phase, setPhase] = useState<Phase>({ kind: "loading", progress: null });

  useEffect(() => {
    let cancelled = false;
    // Next keeps the previous reader route alive (hidden) after "Back to library" and re-runs its
    // effects when it is shown again. Drop the stale viewer so the reopen mounts a fresh one at
    // the latest saved position, instead of re-opening the old viewer mid-layout.
    setPhase((prev) => (prev.kind === "loading" ? prev : { kind: "loading", progress: null }));
    const { documents, readingState, storage, settings: settingsRepo } = services();
    (async () => {
      const [book, saved, settings] = await Promise.all([
        documents.get(documentId),
        readingState.get(documentId),
        settingsRepo.get().catch(() => null),
      ]);
      if (!book) throw new Error("This book is not in your library.");
      let blob: Blob | File | null = await opfsRead(documentId);
      if (!blob) {
        if (book.readStatus !== "readable" || !book.storagePath) {
          throw new Error(
            book.readStatus === "failed"
              ? "This upload failed. Open it on the device you added it from and retry."
              : "This book is still uploading from another device.",
          );
        }
        const url = await storage.getReadUrl(book.storagePath);
        blob = await download(
          url,
          (progress) => !cancelled && setPhase({ kind: "loading", progress }),
        );
        void opfsWrite(documentId, blob);
      }
      const bytes = await blob.arrayBuffer();
      if (cancelled) return;
      // A #a=<annotation> deep link wins over the resume position (the jump would otherwise race it).
      const deepLinked = /[#&]a=/.test(window.location.hash);
      // So does a #p=<page> link (1-based, as in the page indicator).
      const linkedPage = pageFromHash(window.location.hash);
      const initial: ReaderPosition = {
        page: linkedPage !== null ? linkedPage : deepLinked ? 0 : (saved?.page ?? 0),
        offsetPt: deepLinked || linkedPage !== null ? 0 : (saved?.offsetPt ?? 0),
        zoom: saved?.zoom ?? settings?.readerPrefs.defaultZoom ?? "fit-width",
      };
      setPhase({
        kind: "ready",
        book,
        bytes,
        initial,
        seconds: saved?.secondsRead ?? 0,
        labels: settings?.highlightLabels ?? {},
      });
      void documents.update(documentId, { lastOpenedAt: new Date().toISOString() });
    })().catch((error: unknown) => {
      if (!cancelled) {
        setPhase({
          kind: "error",
          message: error instanceof Error ? error.message : "Could not open this book.",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-background" data-testid="reader-route">
      {phase.kind !== "ready" ? <ReaderHeader title="" /> : null}
      {phase.kind === "loading" ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-3"
          data-testid="loading"
        >
          <p className="text-muted-foreground text-sm">Opening your book…</p>
          {phase.progress !== null ? (
            <Progress value={phase.progress * 100} className="w-56" />
          ) : null}
        </div>
      ) : null}
      {phase.kind === "error" ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center" role="alert">
          {phase.message}
        </div>
      ) : null}
      {phase.kind === "ready" ? (
        <Reading
          documentId={documentId}
          bytes={phase.bytes}
          initial={phase.initial}
          initialSeconds={phase.seconds}
          book={phase.book}
          labels={phase.labels}
        />
      ) : null}
    </div>
  );
}

function ReaderHeader({
  title,
  chapter,
  chapterProgress,
  sidebarOpen,
  onToggleSidebar,
}: {
  title: string;
  chapter?: string;
  chapterProgress?: number;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}) {
  return (
    <header className="relative flex h-12 shrink-0 items-center gap-1 border-b px-2 sm:gap-2 sm:px-3">
      <Button asChild variant="ghost" size="icon" aria-label="Back to library">
        <Link href="/app">
          <ArrowLeftIcon />
        </Link>
      </Button>
      {onToggleSidebar ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Contents"
          title="Contents (O)"
          aria-pressed={sidebarOpen}
          data-testid="sidebar-toggle"
          onClick={onToggleSidebar}
        >
          <PanelLeftIcon />
        </Button>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-serif text-base leading-tight" data-testid="book-title">
          {title}
        </h1>
        {chapter ? (
          <p
            className="truncate text-muted-foreground text-xs leading-tight"
            data-testid="chapter-title"
          >
            {chapter}
          </p>
        ) : null}
      </div>
      <SyncStatus />
      <ThemeSwitch />
      {chapter && chapterProgress !== undefined ? (
        <div
          role="progressbar"
          aria-label="Progress in this chapter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(chapterProgress * 100)}
          data-testid="chapter-progress"
          className="absolute inset-x-0 bottom-0 h-0.5"
        >
          <div
            className="h-full bg-primary/70 transition-[width]"
            style={{ width: `${chapterProgress * 100}%` }}
          />
        </div>
      ) : null}
    </header>
  );
}

const SIDEBAR_KEY = "margin.reader.sidebar";
const derivedCache = new Map<string, OutlineItem[]>();

function readSidebarPrefs(): { open: boolean; tab: SidebarTab } {
  try {
    const raw = JSON.parse(localStorage.getItem(SIDEBAR_KEY) ?? "{}") as {
      open?: unknown;
      tab?: unknown;
    };
    const tab = SIDEBAR_TABS.find((t) => t === raw.tab) ?? "chapters";
    return { open: raw.open === true, tab };
  } catch {
    return { open: false, tab: "chapters" };
  }
}

/** Below 768 px the right panel is a bottom sheet (docs/design/reader-layout.md). */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

function Reading({
  documentId,
  bytes,
  initial,
  initialSeconds,
  book,
  labels,
}: {
  book: Book;
  labels: Partial<Record<HighlightColor, string>>;
  documentId: string;
  bytes: ArrayBuffer;
  initial: ReaderPosition;
  initialSeconds: number;
}) {
  const [state, setState] = useState<ViewerState | null>(null);
  const [error, setError] = useState<ReaderError | null>(null);
  const [firstPageMs, setFirstPageMs] = useState<number | null>(null);
  const viewer = useRef<PdfViewerHandle>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [sidebarPrefs, setSidebarPrefs] = useState(readSidebarPrefs);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [derived, setDerived] = useState<OutlineItem[] | null>(
    () => derivedCache.get(documentId) ?? null,
  );
  const [scanning, setScanning] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tab, setTab] = useState("annotations");
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [doc, setDoc] = useState<ReaderDocument | null>(null);
  const narrow = useNarrow();
  const notebook = useNotebook(documentId);
  const position = useRef<ReaderPosition | null>(null);
  const pageCount = useRef(0);
  const seconds = useRef(initialSeconds);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastActive = useRef(Date.now());

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (!dirty.current || !position.current) return;
    dirty.current = false;
    const p = position.current;
    const count = pageCount.current;
    const next: ReadingState = {
      page: p.page,
      offsetPt: p.offsetPt,
      zoom: typeof p.zoom === "number" ? p.zoom : null,
      percent: count > 1 ? (p.page / (count - 1)) * 100 : 0,
      secondsRead: seconds.current,
    };
    void services()
      .readingState.save(documentId, next)
      .catch(() => {
        dirty.current = true;
      });
  }, [documentId]);

  const schedule = useCallback(() => {
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  // Reading time counts only while the tab is visible and the user did something recently.
  useEffect(() => {
    const touch = () => {
      lastActive.current = Date.now();
    };
    const events = ["pointermove", "keydown", "wheel", "scroll", "pointerdown", "touchstart"];
    for (const e of events) window.addEventListener(e, touch, { passive: true, capture: true });
    let ticks = 0;
    const tick = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActive.current > ACTIVE_WINDOW_MS) return;
      seconds.current += 1;
      ticks += 1;
      if (ticks % SECONDS_FLUSH_EVERY === 0) schedule();
    }, 1000);
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      for (const e of events) window.removeEventListener(e, touch, { capture: true });
      clearInterval(tick);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush, schedule]);

  const unsynced = useUnsyncedWrites();
  const layer = useAnnotationLayer({
    documentId,
    title: book.title,
    sha256: book.sha256,
    labels,
    viewer,
    wrapper,
    page: state?.page ?? 0,
    ready: (state?.pageCount ?? 0) > 0,
    inNotebook: notebook.referenced,
    hoverId,
    onMerged: notebook.repoint,
  });
  const { store, jumpTo } = layer;
  useImportExisting({ book, bytes, doc, store, loaded: layer.snap.loaded });

  // PDFs without an outline: look for large-font headings, lazily, once per document.
  const hasOutline = outline.length > 0;
  useEffect(() => {
    if (!doc || hasOutline || derived !== null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setScanning(true);
      deriveOutline(doc, { signal: controller.signal })
        .then((items) => {
          if (controller.signal.aborted) return;
          derivedCache.set(documentId, items);
          setDerived(items);
        })
        .catch(() => !controller.signal.aborted && setDerived([]))
        .finally(() => !controller.signal.aborted && setScanning(false));
    }, 1200);
    return () => {
      clearTimeout(timer);
      controller.abort();
      setScanning(false);
    };
  }, [doc, hasOutline, derived, documentId]);
  const chapterSource = useMemo(
    () => (hasOutline ? outline : (derived ?? [])),
    [hasOutline, outline, derived],
  );
  const allChapters = useMemo(() => flatChapters(chapterSource), [chapterSource]);
  const chapters = useMemo(() => chapterLevel(allChapters), [allChapters]);
  const page = state?.page ?? 0;
  const pageTotal = state?.pageCount ?? 0;
  const chapterIdx = chapterIndexAt(chapters, page);
  const chapter = chapters[chapterIdx];
  const chapterFraction = chapterProgress(chapters, chapterIdx, page, pageTotal);
  const upNext = nextChapterAtEnd(chapters, chapterIdx, page);

  const sidebarOpen = narrow ? sheetOpen : sidebarPrefs.open;
  const setSidebarOpen = useCallback(
    (open: boolean) => {
      if (narrow) setSheetOpen(open);
      else setSidebarPrefs((p) => ({ ...p, open }));
    },
    [narrow],
  );
  const setSidebarTab = useCallback(
    (tab: SidebarTab) => setSidebarPrefs((p) => ({ ...p, tab })),
    [],
  );
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, JSON.stringify(sidebarPrefs));
    } catch {
      // Private mode or blocked storage: the sidebar just starts closed next time.
    }
  }, [sidebarPrefs]);
  const goTo = useCallback(
    (target: number, offsetPt?: number) => {
      viewer.current?.goToPage(target, offsetPt ?? 0);
      if (narrow) setSheetOpen(false);
    },
    [narrow],
  );
  // #p=<page> while the book is open (a pasted chapter link, or editing the address bar).
  useEffect(() => {
    const onHash = () => {
      const target = pageFromHash(window.location.hash, pageCount.current || undefined);
      if (target !== null) goTo(target);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [goTo]);

  const labelMap = useMemo(
    () => ({ ...DEFAULT_HIGHLIGHT_LABELS, ...labels }) as Record<HighlightColor, string>,
    [labels],
  );
  const host = useMemo<QuoteHost>(
    () => ({
      loaded: layer.snap.loaded,
      get: (id) => {
        const a = layer.snap.items.find((i) => i.id === id);
        return a ? { color: a.color, quote: a.quoteText ?? "", page: a.pageStart } : undefined;
      },
      attrsFor: (id) => {
        const a = store.get(id);
        return a
          ? {
              annotationId: a.id,
              quoteSnapshot: a.quoteText ?? "",
              color: a.color,
              page: a.pageStart,
            }
          : undefined;
      },
      jump: (id) => {
        if (narrow) setPanelOpen(false);
        jumpTo(id);
      },
    }),
    [layer.snap, store, jumpTo, narrow],
  );
  const addToNotebook = useCallback(
    (id: string) => {
      const attrs = host.attrsFor(id);
      if (!attrs) return;
      notebook.addQuote(attrs);
      toast.success("Added to your notebook");
    },
    [host, notebook],
  );

  // "P" toggles the right panel and "O" the contents sidebar. The design doc says "]" and "[", but
  // the viewer already uses those for the next and previous chapter (P07).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((key !== "p" && key !== "o") || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      )
        return;
      if (key === "p") setPanelOpen((o) => !o);
      else setSidebarOpen(!sidebarOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen, setSidebarOpen]);

  const sidebar = (
    <ReaderSidebar
      documentId={documentId}
      tab={sidebarPrefs.tab}
      onTab={setSidebarTab}
      outline={chapterSource}
      detected={!hasOutline && chapterSource.length > 0}
      scanning={scanning || (!hasOutline && derived === null)}
      doc={doc}
      page={page}
      bookmarks={layer.bookmarks}
      onGoTo={goTo}
      onBookmark={(id) => {
        if (narrow) setSheetOpen(false);
        layer.jumpTo(id);
      }}
    />
  );

  const panel = (
    <SidePanel
      items={layer.snap.items}
      outline={outline}
      labels={labelMap}
      notebook={notebook}
      host={host}
      tab={tab}
      onTab={setTab}
      onJump={(id) => host.jump(id)}
      onHover={setHoverId}
      onAdd={addToNotebook}
      onDelete={(id) => {
        setHoverId(null);
        layer.removeHighlight(id);
      }}
    />
  );

  const progress = state && state.pageCount > 1 ? (state.page / (state.pageCount - 1)) * 100 : 0;

  return (
    <>
      <ReaderHeader
        title={book.title}
        chapter={chapter?.title}
        chapterProgress={chapter ? chapterFraction : undefined}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      />
      <div className="relative flex min-h-0 flex-1">
        {!narrow && sidebarOpen ? (
          <aside
            aria-label="Contents"
            data-testid="reader-rail"
            className="flex w-72 shrink-0 flex-col border-r bg-background"
          >
            {sidebar}
          </aside>
        ) : null}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: clicks only select a highlight; keys are handled globally */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: wrapper for hit-testing highlights */}
        <div className="relative min-w-0 flex-1" ref={wrapper} onClick={layer.onClick}>
          <PdfViewer
            ref={viewer}
            renderPageOverlay={layer.renderPageOverlay}
            onSelection={layer.onSelection}
            source={bytes}
            initialPosition={initial}
            onPositionChange={(p) => {
              position.current = p;
              schedule();
            }}
            onStateChange={(s) => {
              pageCount.current = s.pageCount;
              setState(s);
            }}
            onFirstPage={setFirstPageMs}
            onDocumentLoad={(d, items) => {
              setDoc(d);
              setOutline(items);
            }}
            onError={setError}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Export"
                data-testid="export-menu"
                className="absolute top-2 right-24 z-10 bg-card/90"
              >
                <DownloadIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                data-testid="export-markdown"
                onSelect={() =>
                  void exportBookMarkdown(documentId, outline)
                    .then(() => toast.success("Markdown exported"))
                    .catch((e: unknown) =>
                      toast.error(e instanceof Error ? e.message : "Export failed"),
                    )
                }
              >
                Export notes as Markdown
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="export-pdf"
                onSelect={() =>
                  void exportBookPdf(documentId, bytes)
                    .then(() => toast.success("Annotated PDF exported"))
                    .catch((e: unknown) =>
                      toast.error(e instanceof Error ? e.message : "Export failed"),
                    )
                }
              >
                Export annotated PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Annotations panel"
            aria-pressed={panelOpen}
            data-testid="panel-toggle"
            className="absolute top-2 right-14 z-10 bg-card/90"
            onClick={() => setPanelOpen((open) => !open)}
          >
            <PanelRightIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Bookmarks"
            aria-pressed={sidebarOpen && sidebarPrefs.tab === "bookmarks"}
            data-testid="bookmarks-toggle"
            className="absolute top-2 right-4 z-10 bg-card/90"
            onClick={() => {
              if (sidebarOpen && sidebarPrefs.tab === "bookmarks") setSidebarOpen(false);
              else {
                setSidebarTab("bookmarks");
                setSidebarOpen(true);
              }
            }}
          >
            <BookmarkIcon />
          </Button>
          {layer.snap.failing ? (
            <output
              className="absolute top-3 left-4 z-10 rounded-md bg-card px-2 py-1 text-destructive text-xs shadow ring-1 ring-destructive"
              data-testid="not-saved"
            >
              Not saved yet. Retrying…
            </output>
          ) : null}
          {upNext ? (
            <button
              type="button"
              data-testid="next-chapter"
              title="Next chapter (])"
              className="absolute bottom-3 left-1/2 z-10 flex min-h-9 max-w-[calc(100%-9rem)] -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1 text-muted-foreground text-xs shadow-md hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => goTo(upNext.page, upNext.offsetPt)}
            >
              <span className="truncate">Next chapter: {upNext.title}</span>
              <ArrowRightIcon className="size-3.5 shrink-0" />
            </button>
          ) : null}
          {state ? (
            <output
              className="absolute right-4 bottom-3 rounded-md bg-card/90 px-2 py-1 text-xs tabular-nums shadow"
              data-testid="page-indicator"
            >
              {state.page + 1} / {state.pageCount}
            </output>
          ) : null}
        </div>
        {panelOpen && !narrow ? (
          <aside
            aria-label="Annotations and notebook"
            data-testid="right-panel"
            className="flex w-[22rem] shrink-0 flex-col border-l bg-background"
          >
            {panel}
          </aside>
        ) : null}
        {narrow ? (
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetContent
              side="left"
              data-testid="reader-sheet"
              className="w-[85%] max-w-80 gap-0 p-0 data-[side=left]:sm:max-w-80"
            >
              <SheetTitle className="flex h-12 shrink-0 items-center px-4 font-serif text-base">
                Contents
              </SheetTitle>
              <div className="min-h-0 flex-1">{sidebar}</div>
            </SheetContent>
          </Sheet>
        ) : null}
        {narrow ? (
          <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
            <SheetContent
              side="bottom"
              data-testid="right-panel"
              className="h-[80vh] gap-0 p-0"
              showCloseButton
            >
              <SheetTitle className="sr-only">Annotations and notebook</SheetTitle>
              {panel}
            </SheetContent>
          </Sheet>
        ) : null}
        {layer.popover}
      </div>
      <div className="h-0.5 shrink-0 bg-border" aria-hidden>
        <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
      </div>
      <div className="sr-only">
        <output data-testid="first-page-ms">
          {firstPageMs === null ? "" : firstPageMs.toFixed(1)}
        </output>
        <output data-testid="error-code">{error?.code ?? ""}</output>
        <output data-testid="pending-writes">{layer.snap.pending + unsynced}</output>
        <output data-testid="notebook-pending">{notebook.pending}</output>
      </div>
    </>
  );
}
