"use client";

import { Button } from "@margin/ui/components/button";
import { IconButton } from "@margin/ui/components/icon-button";
import { Input } from "@margin/ui/components/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@margin/ui/components/tabs";
import { ThemeSwitch } from "@margin/ui/components/theme-switch";
import { useTheme } from "@margin/ui/theme";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  FolderOpenIcon,
  MaximizeIcon,
  MoveHorizontalIcon,
  PanelLeftIcon,
  SearchIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import "@margin/reader/viewer.css";
import type { AnnotationTarget } from "@margin/annotation-model";
import {
  Outline,
  type OutlineItem,
  PdfViewer,
  type PdfViewerHandle,
  type ReaderDocument,
  type ReaderError,
  type ShortcutName,
  Thumbnails,
  type ViewerState,
} from "@margin/reader";

const EMPTY_STATE: ViewerState = {
  page: 0,
  pageCount: 0,
  zoom: "fit-width",
  percent: 100,
  find: { query: "", total: 0, current: -1, searching: false },
};

export function ReaderDemo() {
  const params = useSearchParams();
  const fixture = params.get("fixture");
  const viewer = useRef<PdfViewerHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const gotoInput = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ArrayBuffer | string | null>(
    fixture ? `/dev/reader/file?id=${encodeURIComponent(fixture)}` : null,
  );
  const [title, setTitle] = useState(fixture ?? "");
  const [doc, setDoc] = useState<ReaderDocument | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [state, setState] = useState<ViewerState>(EMPTY_STATE);
  const [railOpen, setRailOpen] = useState(true);
  const [findOpen, setFindOpen] = useState(false);
  const [gotoOpen, setGotoOpen] = useState(false);
  const [selection, setSelection] = useState<AnnotationTarget | null>(null);
  const [firstPageMs, setFirstPageMs] = useState<number | null>(null);
  const [error, setError] = useState<ReaderError | null>(null);
  const { preference, setPreference } = useTheme();

  const onShortcut = useCallback(
    (name: ShortcutName) => {
      if (name === "find") setFindOpen(true);
      else if (name === "goto") setGotoOpen(true);
      else if (name === "theme") {
        const order = ["light", "sepia", "dark"] as const;
        const current = (order as readonly string[]).indexOf(preference);
        setPreference(order[(Math.max(current, 0) + 1) % order.length] ?? "light");
      }
    },
    [preference, setPreference],
  );

  // Dev harness only: lets the E2E suite drive the viewer handle directly.
  useEffect(() => {
    (window as unknown as { __reader?: PdfViewerHandle | null }).__reader = viewer.current;
  });
  useEffect(() => {
    if (findOpen) findInput.current?.select();
  }, [findOpen]);
  useEffect(() => {
    if (gotoOpen) gotoInput.current?.select();
  }, [gotoOpen]);

  const openLocalFile = async (file: File) => {
    // In memory only: the bytes never leave this tab and nothing is stored.
    const bytes = await file.arrayBuffer();
    setTitle(file.name.replace(/\.pdf$/i, ""));
    setDoc(null);
    setOutline([]);
    setError(null);
    setFirstPageMs(null);
    setSource(bytes);
  };

  const { page, pageCount, find } = state;
  const progress = pageCount > 1 ? (page / (pageCount - 1)) * 100 : 0;

  return (
    <div className="flex h-dvh flex-col bg-bg text-text" data-testid="reader-demo">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <IconButton label="Toggle sidebar" size="sm" onClick={() => setRailOpen((v) => !v)}>
          <PanelLeftIcon />
        </IconButton>
        <h1 className="min-w-0 flex-1 truncate font-serif text-base" data-testid="book-title">
          {title || "Open a PDF to start reading"}
        </h1>
        {gotoOpen ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              const value = Number(gotoInput.current?.value);
              if (Number.isFinite(value)) viewer.current?.goToPage(value - 1);
              setGotoOpen(false);
              viewer.current?.focus();
            }}
          >
            <Input
              ref={gotoInput}
              aria-label="Go to page"
              data-testid="goto-input"
              className="w-16 tabular-nums"
              inputMode="numeric"
              defaultValue={page + 1}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setGotoOpen(false);
                  viewer.current?.focus();
                }
              }}
            />
          </form>
        ) : (
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm tabular-nums hover:bg-surface-hover"
            data-testid="page-indicator"
            onClick={() => setGotoOpen(true)}
          >
            {pageCount ? `${page + 1} / ${pageCount}` : "—"}
          </button>
        )}
        <div className="flex items-center gap-0.5">
          <IconButton
            label="Zoom out"
            shortcut="-"
            size="sm"
            onClick={() => viewer.current?.zoomOut()}
          >
            <ZoomOutIcon />
          </IconButton>
          <span className="w-12 text-center text-sm tabular-nums" data-testid="zoom-percent">
            {state.percent}%
          </span>
          <IconButton
            label="Zoom in"
            shortcut="+"
            size="sm"
            onClick={() => viewer.current?.zoomIn()}
          >
            <ZoomInIcon />
          </IconButton>
          <IconButton
            label="Fit width"
            shortcut="0"
            size="sm"
            onClick={() => viewer.current?.setZoom("fit-width")}
          >
            <MoveHorizontalIcon />
          </IconButton>
          <IconButton
            label="Fit page"
            size="sm"
            onClick={() => viewer.current?.setZoom("fit-page")}
          >
            <MaximizeIcon />
          </IconButton>
        </div>
        <IconButton
          label="Find in document"
          shortcut="/"
          size="sm"
          onClick={() => setFindOpen((v) => !v)}
        >
          <SearchIcon />
        </IconButton>
        <ThemeSwitch />
        <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
          <FolderOpenIcon /> Open a PDF…
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          data-testid="file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void openLocalFile(file);
            event.target.value = "";
          }}
        />
      </header>

      <div className="flex min-h-0 flex-1">
        {railOpen ? (
          <aside
            className="w-(--reader-rail-w) shrink-0 overflow-hidden border-r border-border"
            data-testid="rail"
          >
            <Tabs defaultValue="outline" className="h-full gap-0">
              <TabsList className="m-2 shrink-0">
                <TabsTrigger value="outline">Outline</TabsTrigger>
                <TabsTrigger value="thumbnails">Thumbnails</TabsTrigger>
              </TabsList>
              <TabsContent
                value="outline"
                className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 text-sm"
              >
                <Outline
                  items={outline}
                  page={page}
                  onSelect={(item) =>
                    item.page !== undefined && viewer.current?.goToPage(item.page, item.offsetPt)
                  }
                />
              </TabsContent>
              <TabsContent value="thumbnails" className="min-h-0 flex-1 overflow-y-auto">
                <Thumbnails doc={doc} page={page} onSelect={(p) => viewer.current?.goToPage(p)} />
              </TabsContent>
            </Tabs>
          </aside>
        ) : null}

        <main className="relative min-w-0 flex-1">
          {source ? (
            <PdfViewer
              ref={viewer}
              source={source}
              onStateChange={setState}
              onDocumentLoad={(d, items) => {
                setDoc(d);
                setOutline(items);
                void d.title().then((t) => t && !fixture && setTitle((prev) => prev || t));
              }}
              onSelection={setSelection}
              onFirstPage={setFirstPageMs}
              onError={setError}
              onShortcut={onShortcut}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-text-muted">
              Pick a file with “Open a PDF…”, or use ?fixture=&lt;id&gt;.
            </div>
          )}

          {findOpen ? (
            <form
              className="absolute top-3 right-6 z-10 flex items-center gap-1 rounded-lg border border-border bg-surface-raised p-1.5 shadow-md"
              data-testid="find-bar"
              onSubmit={(event) => {
                event.preventDefault();
                if (find.query === findInput.current?.value && find.total > 0)
                  viewer.current?.findNext();
                else viewer.current?.find(findInput.current?.value ?? "");
              }}
            >
              <Input
                ref={findInput}
                aria-label="Find in document"
                data-testid="find-input"
                className="w-48"
                placeholder="Find in document"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setFindOpen(false);
                    viewer.current?.clearFind();
                    viewer.current?.focus();
                  }
                }}
              />
              <span
                className="min-w-16 text-center text-xs tabular-nums text-text-muted"
                data-testid="find-count"
                data-searching={find.searching}
              >
                {find.total
                  ? `${find.current + 1} / ${find.total}`
                  : find.searching
                    ? "…"
                    : find.query
                      ? "0"
                      : ""}
              </span>
              <IconButton
                type="button"
                label="Previous match"
                size="sm"
                onClick={() => viewer.current?.findPrev()}
              >
                <ChevronUpIcon />
              </IconButton>
              <IconButton
                type="button"
                label="Next match"
                size="sm"
                onClick={() => viewer.current?.findNext()}
              >
                <ChevronDownIcon />
              </IconButton>
              <IconButton
                type="button"
                label="Close find"
                size="sm"
                onClick={() => {
                  setFindOpen(false);
                  viewer.current?.clearFind();
                }}
              >
                <XIcon />
              </IconButton>
            </form>
          ) : null}
        </main>
      </div>

      <div className="h-(--reader-progress-h) shrink-0 bg-border" aria-hidden>
        <div className="h-full bg-brand" style={{ width: `${progress}%` }} />
      </div>

      {/* Test hooks for the E2E suite and for eyeballing what P09 will receive. */}
      <div className="sr-only">
        <output data-testid="selection-json">{selection ? JSON.stringify(selection) : ""}</output>
        <output data-testid="first-page-ms">
          {firstPageMs === null ? "" : firstPageMs.toFixed(1)}
        </output>
        <output data-testid="error-code">{error?.code ?? ""}</output>
      </div>
    </div>
  );
}
