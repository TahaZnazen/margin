"use client";

import "@margin/reader/viewer.css";
import { PdfViewer, type ReaderError, type ReaderPosition, type ViewerState } from "@margin/reader";
import { Button } from "@margin/ui/components/button";
import { Progress } from "@margin/ui/components/progress";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Book, ReadingState } from "@/lib/documents/documents-repo";
import { opfsRead, opfsWrite } from "@/lib/documents/opfs";
import { services } from "@/lib/documents/services";
import { createSupabaseSettingsRepo } from "@/lib/settings/supabase-settings-repo";
import { createClient } from "@/lib/supabase/client";

const SAVE_DEBOUNCE_MS = 1000;
const ACTIVE_WINDOW_MS = 30_000;
const SECONDS_FLUSH_EVERY = 15;

type Phase =
  | { kind: "loading"; progress: number | null }
  | { kind: "error"; message: string }
  | { kind: "ready"; book: Book; bytes: ArrayBuffer; initial: ReaderPosition; seconds: number };

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
      setPhase({ kind: "ready", book, bytes, initial, seconds: saved?.secondsRead ?? 0 });
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
}: {
  documentId: string;
  bytes: ArrayBuffer;
  initial: ReaderPosition;
  initialSeconds: number;
}) {
  const [state, setState] = useState<ViewerState | null>(null);
  const [error, setError] = useState<ReaderError | null>(null);
  const [firstPageMs, setFirstPageMs] = useState<number | null>(null);
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

  const progress = state && state.pageCount > 1 ? (state.page / (state.pageCount - 1)) * 100 : 0;

  return (
    <>
      <div className="relative min-h-0 flex-1">
        <PdfViewer
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
        {state ? (
          <output
            className="absolute right-4 bottom-3 rounded-md bg-card/90 px-2 py-1 text-xs tabular-nums shadow"
            data-testid="page-indicator"
          >
            {state.page + 1} / {state.pageCount}
          </output>
        ) : null}
      </div>
      <div className="h-0.5 shrink-0 bg-border" aria-hidden>
        <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
      </div>
      <div className="sr-only">
        <output data-testid="first-page-ms">
          {firstPageMs === null ? "" : firstPageMs.toFixed(1)}
        </output>
        <output data-testid="error-code">{error?.code ?? ""}</output>
      </div>
    </>
  );
}
