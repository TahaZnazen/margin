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
import { Popover, PopoverContent, PopoverTrigger } from "@margin/ui/components/popover";
import { Progress } from "@margin/ui/components/progress";
import { Sheet, SheetContent, SheetTitle } from "@margin/ui/components/sheet";
import { toast } from "@margin/ui/components/sonner";
import { ThemeSwitch } from "@margin/ui/components/theme-switch";
import { cn } from "@margin/ui/lib/utils";
import { useTheme } from "@margin/ui/theme";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookmarkIcon,
  CoffeeIcon,
  DownloadIcon,
  FocusIcon,
  MaximizeIcon,
  MinusIcon,
  MonitorIcon,
  MoonIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
  SearchIcon,
  SunIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QuoteHost } from "@/components/notes/note-editor";
import { SyncStatus } from "@/components/sync-status";
import { palette, type ReaderCommands, useRegisterReaderCommands } from "@/lib/commands/store";
import type { Book, ReadingState } from "@/lib/documents/documents-repo";
import { opfsRead, opfsWrite } from "@/lib/documents/opfs";
import { services } from "@/lib/documents/services";
import { exportBookMarkdown, exportBookPdf } from "@/lib/export/client";
import { deepLink } from "@/lib/export/markdown";
import { useNotebook } from "@/lib/notes/use-notebook";
import { warmPage } from "@/lib/pwa/pwa";
import {
  chapterIndexAt,
  chapterLevel,
  chapterProgress,
  flatChapters,
  nextChapterAtEnd,
  pageFromHash,
} from "@/lib/reader/chapters";
import { copyRich } from "@/lib/reader/citation";
import { formatDuration, paceSecondsPerPage, secondsLeftInRange } from "@/lib/reader/pace";
import { FindBar } from "./find-bar";
import { ReaderSidebar, SIDEBAR_TABS, type SidebarTab } from "./reader-sidebar";
import { SidePanel } from "./side-panel";
import { useAnnotationLayer } from "./use-annotation-layer";
import { useImportExisting } from "./use-import";

const SAVE_DEBOUNCE_MS = 1000;
const ACTIVE_WINDOW_MS = 30_000;
const SECONDS_FLUSH_EVERY = 15;
/** In focus mode the header comes back for this long after a top-edge move or a tap. */
const PEEK_MS = 2500;

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
    // Reloading this book while offline needs its page in the cache (a client-side navigation to
    // it does not store it by itself).
    if (navigator.serviceWorker?.controller)
      void warmPage(window.location.pathname).catch(() => {});
    (async () => {
      let [book, saved, settings] = await Promise.all([
        documents.get(documentId),
        readingState.get(documentId),
        settingsRepo.get().catch(() => null),
      ]);
      // A link opened on a new device (or right after sign-in) can beat the first sync: give the
      // local database a few seconds to receive the row before saying the book is missing.
      for (let tries = 0; !book && tries < 40 && !cancelled; tries++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        [book, saved] = await Promise.all([
          documents.get(documentId),
          readingState.get(documentId),
        ]);
      }
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
      const linkedPage = pageFromHash(window.location.hash, book.pageCount ?? undefined);
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

/** One button that steps through the themes: the four-way switch does not fit a phone header. */
function ThemeCycle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  const order = ["system", "light", "sepia", "dark"] as const;
  const next = order[(order.indexOf(preference as (typeof order)[number]) + 1) % order.length];
  const Icon =
    { system: MonitorIcon, light: SunIcon, sepia: CoffeeIcon, dark: MoonIcon }[
      preference as (typeof order)[number]
    ] ?? SunIcon;
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-8", className)}
      aria-label={`Theme: ${preference}. Switch to ${next}`}
      onClick={() => next && setPreference(next)}
    >
      <Icon />
    </Button>
  );
}

interface ZoomActions {
  percent: number;
  zoomIn: () => void;
  zoomOut: () => void;
  fitWidth: () => void;
  fitPage: () => void;
}

function ZoomControls({ percent, zoomIn, zoomOut, fitWidth, fitPage }: ZoomActions) {
  const label = `${Math.round(percent)}%`;
  const fit = (
    <>
      <Button variant="outline" size="sm" onClick={fitWidth}>
        Fit width
      </Button>
      <Button variant="outline" size="sm" onClick={fitPage}>
        Fit page
      </Button>
    </>
  );
  return (
    <>
      <div className="hidden items-center gap-0.5 sm:flex" data-testid="zoom-controls">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Zoom out"
          title="Zoom out (-)"
          onClick={zoomOut}
        >
          <MinusIcon />
        </Button>
        <output className="min-w-10 text-center text-xs tabular-nums" data-testid="zoom-percent">
          {label}
        </output>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Zoom in"
          title="Zoom in (+)"
          onClick={zoomIn}
        >
          <PlusIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Fit width"
          title="Fit width (0)"
          onClick={fitWidth}
        >
          <MaximizeIcon />
        </Button>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-1.5 text-xs tabular-nums sm:hidden"
            aria-label={`Zoom: ${label}`}
            data-testid="zoom-menu"
          >
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto space-y-2 p-2" data-testid="zoom-popover">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Zoom out" onClick={zoomOut}>
              <MinusIcon />
            </Button>
            <output
              className="min-w-12 text-center text-sm tabular-nums"
              data-testid="zoom-percent-phone"
            >
              {label}
            </output>
            <Button variant="outline" size="icon" aria-label="Zoom in" onClick={zoomIn}>
              <PlusIcon />
            </Button>
          </div>
          <div className="flex gap-1">{fit}</div>
        </PopoverContent>
      </Popover>
    </>
  );
}

function ReaderHeader({
  title,
  chapter,
  chapterProgress,
  chapterLeft,
  sidebarOpen,
  onToggleSidebar,
  actions,
  hidden,
  overlay,
}: {
  title: string;
  chapter?: string;
  chapterProgress?: number;
  /** "8 min": time left in the chapter, when the pace is known. */
  chapterLeft?: string;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  actions?: React.ReactNode;
  /** Slid away while reading on a phone; the page keeps its place. */
  hidden?: boolean;
  /** Float over the page instead of taking its own row (phones). */
  overlay?: boolean;
}) {
  return (
    <header
      data-testid="reader-header"
      data-hidden={hidden ? "true" : undefined}
      inert={hidden}
      className={cn(
        "z-10 flex h-12 shrink-0 items-center gap-1 border-b bg-background px-2 transition-[transform,opacity] duration-(--duration-chrome) sm:gap-2 sm:px-3",
        // On phones the bar floats over the page, so hiding it never moves the text.
        overlay ? "absolute inset-x-0 top-0" : "relative",
        hidden && "-translate-y-full opacity-0",
      )}
    >
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
            {chapterLeft ? (
              <span className="hidden lg:inline" data-testid="chapter-time-left-header">
                {" "}
                · {chapterLeft} left in chapter
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
      <SyncStatus />
      {actions}
      <ThemeSwitch className="hidden sm:flex" />
      <ThemeCycle className="sm:hidden" />
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

/** How often (in active seconds) the shown pace is refreshed, so the reader doesn't re-render every second. */
const PACE_REFRESH_EVERY = 15;

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

/** Phones: the top bar floats over the page and slides away while reading (reader-layout.md). */
function useCompactChrome(): boolean {
  return useNarrow();
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
  const compactChrome = useCompactChrome();
  const { preference, setPreference } = useTheme();
  const cycleTheme = () => {
    const order = ["system", "light", "sepia", "dark"] as const;
    const next = order[(order.indexOf(preference as (typeof order)[number]) + 1) % order.length];
    if (next) setPreference(next);
  };
  const [barHidden, setBarHidden] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findSeed, setFindSeed] = useState({ text: "", nonce: 0 });
  const openFind = useCallback((text = "") => {
    setFindOpen(true);
    setFindSeed((s) => ({ text, nonce: s.nonce + 1 }));
  }, []);
  // Focus mode: only the page. Header, contents and panel are hidden; the header peeks back for
  // PEEK_MS when the pointer reaches the top edge or on a tap. Not persisted.
  const [focus, setFocus] = useState(false);
  const [peek, setPeek] = useState(false);
  const fullscreenHeld = useRef(false);
  const enterFocus = useCallback(() => {
    setFocus(true);
    setPeek(false);
    try {
      // May be missing (iOS Safari) or rejected (iframe, automation): the chrome hides regardless.
      const request = document.documentElement.requestFullscreen?.();
      if (request) void request.catch(() => {});
    } catch {
      // Fullscreen is a nicety, never a requirement.
    }
  }, []);
  const leaveFocus = useCallback(() => {
    setFocus(false);
    setPeek(false);
    fullscreenHeld.current = false;
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    } catch {
      // Already out of fullscreen.
    }
  }, []);
  const toggleFocus = useCallback(
    () => (focus ? leaveFocus() : enterFocus()),
    [focus, enterFocus, leaveFocus],
  );
  const notebook = useNotebook(documentId);
  const position = useRef<ReaderPosition | null>(null);
  const pageCount = useRef(0);
  const seconds = useRef(initialSeconds);
  const [secondsShown, setSecondsShown] = useState(initialSeconds);
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
      if (ticks % PACE_REFRESH_EVERY === 0) setSecondsShown(seconds.current);
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

  // Esc: note what was open BEFORE the annotation layer (registered next) and Radix react to the
  // key, so focus mode only leaves when nothing nearer was there to close.
  const popoverShown = useRef(false);
  const escapeHadTarget = useRef(false);
  useEffect(() => {
    const snapshot = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      escapeHadTarget.current =
        popoverShown.current ||
        !!document.querySelector(
          '[role="dialog"]:not([data-state="closed"]), [role="menu"]:not([data-state="closed"])',
        );
    };
    window.addEventListener("keydown", snapshot, true);
    return () => window.removeEventListener("keydown", snapshot, true);
  }, []);

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
  const secPerPage = paceSecondsPerPage(secondsShown, page);
  const chapterEnd =
    chapterIdx >= 0
      ? (chapters.slice(chapterIdx + 1).find((c) => c.page > (chapters[chapterIdx]?.page ?? 0))
          ?.page ?? pageTotal)
      : pageTotal;
  const chapterLeft = secondsLeftInRange(secPerPage, page, chapterEnd);

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

  // Top bar: slides away on scroll down, returns on scroll up, on a tap on the page and on Esc.
  useEffect(() => {
    const el = wrapper.current;
    if (!(el && compactChrome)) {
      setBarHidden(false);
      return;
    }
    let last: number | null = null;
    let travelled = 0;
    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains("mr-scroller")) return;
      const top = target.scrollTop;
      if (last !== null) {
        const delta = top - last;
        travelled = Math.sign(delta) === Math.sign(travelled) ? travelled + delta : delta;
        if (travelled > 24 && top > 48) setBarHidden(true);
        else if (travelled < -16 || top <= 48) setBarHidden(false);
      }
      last = top;
    };
    const onTap = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      if (window.getSelection()?.toString()) return;
      setBarHidden((hidden) => (hidden ? false : hidden));
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBarHidden(false);
    };
    el.addEventListener("scroll", onScroll, true);
    el.addEventListener("pointerup", onTap);
    window.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("scroll", onScroll, true);
      el.removeEventListener("pointerup", onTap);
      window.removeEventListener("keydown", onKey);
    };
  }, [compactChrome]);

  // Browser-level exit from fullscreen (its own Esc, F11) also leaves focus mode.
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement) fullscreenHeld.current = true;
      else if (fullscreenHeld.current) {
        fullscreenHeld.current = false;
        setFocus(false);
        setPeek(false);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      try {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      } catch {
        // Nothing to leave.
      }
    };
  }, []);

  // Focus mode: the top edge (mouse) or a tap (touch, pen) shows the header for PEEK_MS.
  useEffect(() => {
    if (!focus) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(function expire() {
        const header = document.querySelector('[data-testid="reader-header"]');
        const busy =
          header?.contains(document.activeElement) ||
          document.querySelector('[role="menu"], [data-radix-popper-content-wrapper]');
        if (busy) timer = setTimeout(expire, PEEK_MS);
        else setPeek(false);
      }, PEEK_MS);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      if (event.clientY <= 6) {
        setPeek(true);
        arm();
      } else if (event.clientY <= 56) {
        // Still near the bar: keep it while it is showing.
        setPeek((shown) => {
          if (shown) arm();
          return shown;
        });
      }
    };
    const onTap = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      if (window.getSelection()?.toString()) return;
      setPeek(true);
      arm();
    };
    window.addEventListener("pointermove", onMove);
    const el = wrapper.current;
    el?.addEventListener("pointerup", onTap);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      el?.removeEventListener("pointerup", onTap);
    };
  }, [focus]);

  const zoomActions = useMemo(
    () => ({
      zoomIn: () => viewer.current?.zoomIn(),
      zoomOut: () => viewer.current?.zoomOut(),
      fitWidth: () => viewer.current?.setZoom("fit-width"),
      fitPage: () => viewer.current?.setZoom("fit-page"),
    }),
    [],
  );

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

  const commands = useMemo<ReaderCommands>(
    () => ({
      title: book.title,
      pageCount: pageTotal,
      goToPage: (target) => goTo(target),
      chapters: allChapters,
      goToChapter: (target, offsetPt) => goTo(target, offsetPt),
      annotations: layer.snap.items.map((a) => ({
        id: a.id,
        kind: a.kind,
        quote: a.quoteText ?? "",
        comment: a.comment ?? "",
        page: a.pageStart,
      })),
      jumpToAnnotation: (id) => host.jump(id),
      toggleSidebar: () => setSidebarOpen(!sidebarOpen),
      togglePanel: () => setPanelOpen((o) => !o),
      toggleFocus,
      openFind,
      ...zoomActions,
    }),
    [
      book.title,
      pageTotal,
      goTo,
      allChapters,
      layer.snap.items,
      host,
      setSidebarOpen,
      sidebarOpen,
      toggleFocus,
      openFind,
      zoomActions,
    ],
  );
  useRegisterReaderCommands(commands);

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

  // "F" toggles focus mode. Esc leaves it, but only when nothing nearer needs the key: a text field,
  // an open menu or dialog, the annotation popover (the annotation layer clears it), the find bar.
  popoverShown.current = layer.popover !== null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      )
        return;
      if (e.key === "f" || e.key === "F") {
        if (e.repeat) return;
        e.preventDefault();
        toggleFocus();
      } else if (e.key === "Escape" && focus) {
        if (escapeHadTarget.current) return;
        if (findOpen) setFindOpen(false);
        else leaveFocus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, findOpen, toggleFocus, leaveFocus]);

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
      pageCount={pageTotal}
      secPerPage={secPerPage}
      bookmarks={layer.bookmarks}
      onGoTo={goTo}
      onBookmark={(id) => {
        if (narrow) setSheetOpen(false);
        layer.jumpTo(id);
      }}
      onRenameBookmark={(id, name) => layer.store.update(id, { comment: name || null }, `bm-${id}`)}
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
      onCopyLink={(id) => {
        void copyRich(deepLink(window.location.origin, documentId, id)).then((ok) =>
          ok
            ? toast.success("Link copied", { id: "copy-link" })
            : toast.error("Could not copy the link", { id: "copy-link" }),
        );
      }}
      onDelete={(id) => {
        setHoverId(null);
        layer.removeHighlight(id);
      }}
    />
  );

  const actions = (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 sm:size-9"
        aria-label="Find in this book"
        title="Find in this book (Ctrl+F)"
        aria-pressed={findOpen}
        data-testid="find-toggle"
        onClick={() => openFind()}
      >
        <SearchIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="hidden size-9 sm:inline-flex"
        aria-label="Focus mode"
        title="Focus mode (F)"
        aria-pressed={focus}
        data-testid="focus-toggle"
        onClick={toggleFocus}
      >
        <FocusIcon />
      </Button>
      <ZoomControls percent={state?.percent ?? 100} {...zoomActions} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 sm:size-9"
            aria-label="Export"
            data-testid="export-menu"
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
        className="size-8 sm:size-9"
        aria-label="Annotations panel"
        aria-pressed={panelOpen}
        data-testid="panel-toggle"
        onClick={() => setPanelOpen((open) => !open)}
      >
        <PanelRightIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 sm:size-9"
        aria-label="Bookmarks"
        aria-pressed={sidebarOpen && sidebarPrefs.tab === "bookmarks"}
        data-testid="bookmarks-toggle"
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
    </>
  );

  const progress = state && state.pageCount > 1 ? (state.page / (state.pageCount - 1)) * 100 : 0;

  return (
    <>
      <ReaderHeader
        title={book.title}
        chapter={chapter?.title}
        chapterProgress={chapter ? chapterFraction : undefined}
        chapterLeft={chapter && chapterLeft !== null ? formatDuration(chapterLeft) : undefined}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        actions={actions}
        hidden={focus ? !peek : barHidden}
        overlay={compactChrome || focus}
      />
      <div className="relative flex min-h-0 flex-1">
        {!narrow && sidebarOpen ? (
          <aside
            aria-label="Contents"
            data-testid="reader-rail"
            className={cn("flex w-72 shrink-0 flex-col border-r bg-background", focus && "hidden")}
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
            onShortcut={(name) => {
              if (name === "find") openFind();
              else if (name === "goto") palette.open("page ");
              else if (name === "help") palette.openHelp();
              else if (name === "theme") cycleTheme();
            }}
          />
          {findOpen && state ? (
            <FindBar
              viewer={viewer}
              find={state.find}
              seed={findSeed}
              onClose={() => setFindOpen(false)}
              className={cn(
                "absolute z-20 transition-[top] duration-(--duration-chrome) max-sm:inset-x-2 sm:top-3 sm:right-4",
                (focus ? peek : compactChrome && !barHidden) ? "top-14" : "top-2",
              )}
            />
          ) : null}
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
            className={cn(
              "flex w-[22rem] shrink-0 flex-col border-l bg-background",
              focus && "hidden",
            )}
          >
            {panel}
          </aside>
        ) : null}
        {narrow ? (
          <Sheet open={sheetOpen && !focus} onOpenChange={setSheetOpen}>
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
          <Sheet open={panelOpen && !focus} onOpenChange={setPanelOpen}>
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
