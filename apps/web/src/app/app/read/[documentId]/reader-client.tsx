"use client";

import "@margin/reader/viewer.css";
import "./annotations.css";
import type { HighlightColor } from "@margin/annotation-model";
import {
  PdfViewer,
  type PdfViewerHandle,
  type ReaderError,
  type ReaderPosition,
  type ViewerState,
} from "@margin/reader";
import { Button } from "@margin/ui/components/button";
import { Progress } from "@margin/ui/components/progress";
import { ThemeSwitch } from "@margin/ui/components/theme-switch";
import { ArrowLeftIcon, BookmarkIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Book, ReadingState } from "@/lib/documents/documents-repo";
import { opfsRead, opfsWrite } from "@/lib/documents/opfs";
import { services } from "@/lib/documents/services";
import { createSupabaseSettingsRepo } from "@/lib/settings/supabase-settings-repo";
import { createClient } from "@/lib/supabase/client";
import { useAnnotationLayer } from "./use-annotation-layer";

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
    const { documents, readingState, storage } = services();
    (async () => {
      const [book, saved, settings] = await Promise.all([
        documents.get(documentId),
        readingState.get(documentId),
        createSupabaseSettingsRepo(createClient())
          .get()
          .catch(() => null),
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
      const initial: ReaderPosition = {
        page: saved?.page ?? 0,
        offsetPt: saved?.offsetPt ?? 0,
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
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to library">
          <Link href="/app">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <h1 className="min-w-0 flex-1 truncate font-serif text-base" data-testid="book-title">
          {phase.kind === "ready" ? phase.book.title : ""}
        </h1>
        <ThemeSwitch />
      </header>
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
  const [railOpen, setRailOpen] = useState(false);
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

  const layer = useAnnotationLayer({
    documentId,
    title: book.title,
    sha256: book.sha256,
    labels,
    viewer,
    wrapper,
    page: state?.page ?? 0,
    ready: (state?.pageCount ?? 0) > 0,
  });

  const progress = state && state.pageCount > 1 ? (state.page / (state.pageCount - 1)) * 100 : 0;

  return (
    <>
      <div className="relative flex min-h-0 flex-1">
        {railOpen ? (
          <nav
            aria-label="Bookmarks"
            data-testid="bookmarks-panel"
            className="w-56 shrink-0 overflow-y-auto border-r p-2 text-sm"
          >
            {layer.bookmarks.length === 0 ? (
              <p className="p-2 text-muted-foreground">Press B to bookmark a page.</p>
            ) : (
              <ul>
                {layer.bookmarks.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      data-testid="bookmark-item"
                      className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
                      onClick={() => layer.jumpTo(b.id)}
                    >
                      Page {b.pageStart + 1}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
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
            onError={setError}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Bookmarks"
            aria-pressed={railOpen}
            data-testid="bookmarks-toggle"
            className="absolute top-2 right-4 z-10 bg-card/90"
            onClick={() => setRailOpen((open) => !open)}
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
          {state ? (
            <output
              className="absolute right-4 bottom-3 rounded-md bg-card/90 px-2 py-1 text-xs tabular-nums shadow"
              data-testid="page-indicator"
            >
              {state.page + 1} / {state.pageCount}
            </output>
          ) : null}
        </div>
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
        <output data-testid="pending-writes">{layer.snap.pending}</output>
      </div>
    </>
  );
}
