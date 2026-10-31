"use client";

import { Button } from "@margin/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@margin/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@margin/ui/components/dropdown-menu";
import { Input } from "@margin/ui/components/input";
import { Skeleton } from "@margin/ui/components/skeleton";
import { toast } from "@margin/ui/components/sonner";
import { cn } from "@margin/ui/lib/utils";
import {
  AlertTriangleIcon,
  CloudDownloadIcon,
  LayoutGridIcon,
  ListIcon,
  MoreVerticalIcon,
  UploadIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flags } from "@/config/flags";
import {
  allDone,
  type ChapterSummary,
  hasChapterProgress,
  progressScore,
} from "@/lib/chapters/progress";
import { useChapterSummaries } from "@/lib/chapters/use-chapter-summaries";
import { UNDO_WINDOW_MS } from "@/lib/documents/config";
import {
  type Book,
  READING_STATUS_LABELS,
  READING_STATUSES,
  type ReadingStatus,
} from "@/lib/documents/documents-repo";
import { keepOffline } from "@/lib/documents/offline";
import { opfsList, opfsRemove } from "@/lib/documents/opfs";
import { services } from "@/lib/documents/services";
import { libraryProgressLine } from "@/lib/reader/pace";
import {
  ALL_BOOKS,
  filterByShelf,
  onShelfSelected,
  readSelectedShelf,
  selectShelf,
  shelfCounts,
  shelvesOfBook,
} from "@/lib/shelves/logic";
import type { Shelf } from "@/lib/shelves/shelves-repo";
import { useShelves } from "@/lib/shelves/use-shelves";
import { BookShelvesDialog, ShelfBar, ShelfNameDialog } from "./shelf-bar";
import { useUploads } from "./upload-provider";

type Sort = "recent" | "title" | "progress";
type View = "grid" | "list";

function lastOpened(book: Book): string {
  const when = book.lastOpenedAt;
  return when ? `Opened ${new Date(when).toLocaleDateString()}` : "Not opened yet";
}

/** The label shown on a card: the user's own, else Finished once every chapter is done. */
function effectiveStatus(book: Book, summary: ChapterSummary | undefined): ReadingStatus | null {
  return book.readingStatus ?? (allDone(summary) ? "finished" : null);
}

function sortBooks(
  books: Book[],
  sort: Sort,
  summaries: Map<string, ChapterSummary> | null,
): Book[] {
  const copy = [...books];
  const score = (b: Book) => progressScore(summaries?.get(b.id), b.percent);
  if (sort === "title") copy.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === "progress") copy.sort((a, b) => score(b) - score(a));
  else {
    const key = (b: Book) => b.lastOpenedAt ?? b.createdAt;
    copy.sort((a, b) => key(b).localeCompare(key(a)));
  }
  return copy;
}

export function LibraryView() {
  const { version, pickFiles, jobs } = useUploads();
  const [books, setBooks] = useState<Book[] | null>(null);
  const [covers, setCovers] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [view, setView] = useState<View>("grid");
  const [statusFilter, setStatusFilter] = useState<ReadingStatus | "all">("all");
  const chapterSummaries = useChapterSummaries();
  // Flag off: no chapter data reaches the cards, the sort or the status filter.
  const summaries = flags.chapterProgress ? chapterSummaries : null;
  const [editing, setEditing] = useState<Book | null>(null);
  // Books whose PDF is stored on this device (opened once, or "Keep offline").
  const [offlineIds, setOfflineIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const shelfData = useShelves();
  const shelves = shelfData?.shelves;
  const links = shelfData?.links;
  const [selectedShelf, setSelectedShelf] = useState(ALL_BOOKS);
  const [nameDialog, setNameDialog] = useState<
    { kind: "new" } | { kind: "rename"; shelf: Shelf } | null
  >(null);
  const [shelvesFor, setShelvesFor] = useState<Book | null>(null);
  const pendingDeletes = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // The chosen shelf is remembered per device; the command palette can switch it too.
  useEffect(() => {
    setSelectedShelf(readSelectedShelf());
    return onShelfSelected(setSelectedShelf);
  }, []);

  // Bumps when documents change on another device or tab.
  const [syncTick, setSyncTick] = useState(0);
  useEffect(() => services().documents.subscribe?.(() => setSyncTick((t) => t + 1)), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` and `syncTick` are reload signals.
  useEffect(() => {
    let cancelled = false;
    const { documents, storage } = services();
    documents
      .list()
      .then(async (list) => {
        if (cancelled) return;
        setBooks(list);
        setError(null);
        const paths = list.flatMap((b) => (b.coverPath ? [b.coverPath] : []));
        const urls = await storage.getReadUrls(paths).catch(() => new Map<string, string>());
        if (!cancelled) setCovers(urls);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Failed"));
    return () => {
      cancelled = true;
    };
  }, [version, syncTick]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `books` changes when the library changes.
  useEffect(() => {
    void opfsList().then((list) => setOfflineIds(new Set(list.map((f) => f.id))));
  }, [books]);

  const toggleOffline = useCallback(async (book: Book, keep: boolean) => {
    if (!keep) {
      await opfsRemove(book.id);
      setOfflineIds((ids) => new Set([...ids].filter((id) => id !== book.id)));
      toast(`Removed "${book.title}" from this device`);
      return;
    }
    setDownloading((ids) => new Set(ids).add(book.id));
    try {
      await keepOffline(book);
      setOfflineIds((ids) => new Set(ids).add(book.id));
      toast.success(`"${book.title}" is available offline`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not keep this book offline.");
    } finally {
      setDownloading((ids) => new Set([...ids].filter((id) => id !== book.id)));
    }
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (books ?? []).filter(
      (b) =>
        (!q || b.title.toLowerCase().includes(q) || (b.author ?? "").toLowerCase().includes(q)) &&
        (statusFilter === "all" || effectiveStatus(b, summaries?.get(b.id)) === statusFilter),
    );
    return sortBooks(
      filterByShelf(filtered, links ?? [], selectedShelf, shelves ?? []),
      sort,
      summaries,
    );
  }, [books, query, sort, links, shelves, selectedShelf, statusFilter, summaries]);

  const setStatus = useCallback(async (book: Book, status: ReadingStatus | null) => {
    setBooks(
      (all) => all?.map((b) => (b.id === book.id ? { ...b, readingStatus: status } : b)) ?? null,
    );
    await services().documents.update(book.id, { readingStatus: status });
  }, []);

  const counts = useMemo(() => shelfCounts(shelves ?? [], links ?? []), [shelves, links]);
  // A shelf deleted on another device must not leave the library looking empty.
  const activeShelf = shelves?.find((s) => s.id === selectedShelf);
  const shownShelf = activeShelf ? selectedShelf : ALL_BOOKS;

  const createShelf = useCallback(async (name: string, documentId?: string) => {
    const repo = services().shelves;
    const shelf = await repo.create(name);
    if (documentId) await repo.setMember(shelf.id, documentId, true);
    return shelf;
  }, []);

  const deleteShelf = useCallback(
    async (shelf: Shelf) => {
      const repo = services().shelves;
      const linkIds = await repo.softDelete(shelf.id);
      if (selectedShelf === shelf.id) selectShelf(ALL_BOOKS);
      toast(`Deleted shelf "${shelf.name}". Its books stay in your library.`, {
        duration: UNDO_WINDOW_MS,
        action: { label: "Undo", onClick: () => void repo.restore(shelf.id, linkIds) },
      });
    },
    [selectedShelf],
  );

  const remove = useCallback((book: Book) => {
    const { documents, storage } = services();
    setBooks((all) => all?.filter((b) => b.id !== book.id) ?? null);
    void documents.softDelete(book.id);
    const timer = setTimeout(() => {
      pendingDeletes.current.delete(book.id);
      const paths = [book.storagePath, book.coverPath].filter((p): p is string => Boolean(p));
      void storage.remove(paths).catch(() => {});
      void opfsRemove(book.id);
    }, UNDO_WINDOW_MS);
    pendingDeletes.current.set(book.id, timer);
    toast(`Deleted "${book.title}"`, {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Undo",
        onClick: () => {
          clearTimeout(timer);
          pendingDeletes.current.delete(book.id);
          void documents
            .restore(book.id)
            .then(() => setBooks((all) => (all ? [...all, book] : all)));
        },
      },
    });
  }, []);

  const save = useCallback(async (book: Book, title: string, author: string) => {
    const patch = { title: title.trim() || book.title, author: author.trim() || null };
    await services().documents.update(book.id, patch);
    setBooks((all) => all?.map((b) => (b.id === book.id ? { ...b, ...patch } : b)) ?? null);
  }, []);

  return (
    // The upload tray floats over the bottom of the page: keep room so it never hides the last row.
    <div
      className="space-y-5"
      data-testid="library"
      style={{ paddingBottom: jobs.length > 0 ? `${jobs.length * 5.5 + 1}rem` : undefined }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto font-semibold font-serif text-2xl">Library</h1>
        <Input
          aria-label="Search library"
          placeholder="Search title or author"
          className="w-56"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Sort"
          className="h-8 rounded-lg border bg-background px-2 text-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
        >
          <option value="recent">Recent</option>
          <option value="title">Title</option>
          <option value="progress">Progress</option>
        </select>
        <select
          aria-label="Status"
          data-testid="status-filter"
          className="h-8 rounded-lg border bg-background px-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ReadingStatus | "all")}
        >
          <option value="all">All statuses</option>
          {READING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {READING_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <Button
          variant={view === "grid" ? "secondary" : "ghost"}
          size="icon"
          aria-label="Grid view"
          onClick={() => setView("grid")}
        >
          <LayoutGridIcon />
        </Button>
        <Button
          variant={view === "list" ? "secondary" : "ghost"}
          size="icon"
          aria-label="List view"
          onClick={() => setView("list")}
        >
          <ListIcon />
        </Button>
        <Button onClick={pickFiles}>
          <UploadIcon /> Add PDFs
        </Button>
      </div>

      {books && books.length > 0 ? (
        <ShelfBar
          shelves={shelves ?? []}
          counts={counts}
          total={books.length}
          selected={shownShelf}
          onSelect={selectShelf}
          onNew={() => setNameDialog({ kind: "new" })}
          onRename={(shelf) => setNameDialog({ kind: "rename", shelf })}
          onDelete={(shelf) => void deleteShelf(shelf)}
        />
      ) : null}

      {error ? (
        <p className="text-destructive text-sm">Could not load your library: {error}</p>
      ) : null}

      {books === null && !error ? (
        <div
          className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5"
          data-testid="skeletons"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="aspect-[3/4] w-full" />
          ))}
        </div>
      ) : null}

      {books && books.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-20 text-center"
          data-testid="empty-state"
        >
          <p className="font-serif text-xl">Drop a PDF here to start your library</p>
          <p className="text-muted-foreground text-sm">
            Drag a file anywhere on this page, or pick one.
          </p>
          <Button onClick={pickFiles}>
            <UploadIcon /> Choose PDFs
          </Button>
        </div>
      ) : null}

      {books && books.length > 0 && visible.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="no-matches">
          {query.trim()
            ? `No books match "${query}".`
            : "This shelf is empty. Choose All books, then use a book's menu > Shelves."}
        </p>
      ) : null}

      <div
        className={cn(
          view === "grid"
            ? "grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5"
            : "flex flex-col divide-y rounded-xl border",
        )}
      >
        {visible.map((book) => (
          <BookItem
            key={book.id}
            book={book}
            summary={summaries?.get(book.id)}
            onSetStatus={(status) => void setStatus(book, status)}
            cover={book.coverPath ? covers.get(book.coverPath) : undefined}
            view={view}
            offline={offlineIds.has(book.id)}
            downloading={downloading.has(book.id)}
            onToggleOffline={(keep) => void toggleOffline(book, keep)}
            onEdit={() => setEditing(book)}
            onShelves={() => setShelvesFor(book)}
            onDelete={() => remove(book)}
          />
        ))}
      </div>

      <ShelfNameDialog
        open={nameDialog !== null}
        title={nameDialog?.kind === "rename" ? "Rename shelf" : "New shelf"}
        initial={nameDialog?.kind === "rename" ? nameDialog.shelf.name : ""}
        submitLabel={nameDialog?.kind === "rename" ? "Rename" : "Create shelf"}
        onClose={() => setNameDialog(null)}
        onSubmit={async (name) => {
          if (nameDialog?.kind === "rename")
            await services().shelves.rename(nameDialog.shelf.id, name);
          else await createShelf(name);
        }}
      />
      <BookShelvesDialog
        title={shelvesFor?.title ?? null}
        shelves={shelves ?? []}
        memberOf={shelvesFor ? shelvesOfBook(links ?? [], shelvesFor.id) : new Set()}
        onToggle={(shelf, member) =>
          shelvesFor && void services().shelves.setMember(shelf.id, shelvesFor.id, member)
        }
        onCreate={async (name) => {
          if (shelvesFor) await createShelf(name, shelvesFor.id);
        }}
        onClose={() => setShelvesFor(null)}
      />

      <EditDialog book={editing} onClose={() => setEditing(null)} onSave={save} />
    </div>
  );
}

function BookItem({
  book,
  summary,
  onSetStatus,
  cover,
  view,
  offline,
  downloading,
  onToggleOffline,
  onEdit,
  onShelves,
  onDelete,
}: {
  book: Book;
  summary: ChapterSummary | undefined;
  onSetStatus: (status: ReadingStatus | null) => void;
  cover?: string;
  view: View;
  offline: boolean;
  downloading: boolean;
  onToggleOffline: (keep: boolean) => void;
  onEdit: () => void;
  onShelves: () => void;
  onDelete: () => void;
}) {
  const grid = view === "grid";
  const status = effectiveStatus(book, summary);
  const chapters = hasChapterProgress(summary) ? summary : null;
  const progressLine = libraryProgressLine({
    page: book.readingPage,
    pageCount: book.pageCount,
    percent: book.percent,
    secondsRead: book.secondsRead,
  });
  return (
    <div
      data-testid="book"
      data-title={book.title}
      className={cn("group relative", grid ? "space-y-2" : "flex items-center gap-4 p-3")}
    >
      <Link
        href={`/app/read/${book.id}`}
        className={cn(
          "block overflow-hidden rounded-lg border bg-muted",
          grid ? "aspect-[3/4] w-full" : "h-20 w-14 shrink-0",
        )}
        aria-label={`Open ${book.title}`}
      >
        {cover ? (
          // biome-ignore lint/performance/noImgElement: signed storage URL, not optimizable by next/image
          <img src={cover} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center p-2 text-center font-serif text-muted-foreground text-xs">
            {book.title}
          </span>
        )}
      </Link>
      <div className={cn("min-w-0", !grid && "flex-1")}>
        <div className="flex items-start gap-1">
          <Link
            href={`/app/read/${book.id}`}
            className="line-clamp-2 min-w-0 flex-1 font-medium text-sm"
            data-testid="book-title"
          >
            {book.title}
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Menu for ${book.title}`}>
                <MoreVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuCheckboxItem
                checked={offline}
                disabled={downloading || book.readStatus !== "readable"}
                onCheckedChange={onToggleOffline}
              >
                {downloading ? "Downloading…" : "Keep offline"}
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem onSelect={onEdit}>Rename or edit author</DropdownMenuItem>
              <DropdownMenuItem onSelect={onShelves}>Shelves…</DropdownMenuItem>
              <DropdownMenuSeparator />
              {READING_STATUSES.map((s) => (
                <DropdownMenuItem key={s} data-testid={`mark-${s}`} onSelect={() => onSetStatus(s)}>
                  Mark as: {READING_STATUS_LABELS[s]}
                </DropdownMenuItem>
              ))}
              {book.readingStatus ? (
                <DropdownMenuItem data-testid="mark-clear" onSelect={() => onSetStatus(null)}>
                  Clear status
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onDelete}>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {book.author ? (
          <p className="truncate text-muted-foreground text-xs">{book.author}</p>
        ) : null}
        {chapters && chapters.total <= 40 ? (
          <div
            className="mt-1.5 flex h-1 gap-px"
            role="progressbar"
            aria-label="Chapters done"
            aria-valuemin={0}
            aria-valuemax={chapters.total}
            aria-valuenow={chapters.done}
            data-testid="chapter-segments"
          >
            {chapters.segments.map((filled, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
                key={i}
                data-filled={filled ? "true" : "false"}
                className={cn("h-full flex-1 rounded-full", filled ? "bg-primary" : "bg-border")}
              />
            ))}
          </div>
        ) : (
          <div
            className="mt-1.5 h-1 overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-label="Reading progress"
            aria-valuenow={Math.round(
              chapters ? (chapters.done / chapters.total) * 100 : book.percent,
            )}
          >
            <div
              className="h-full bg-primary"
              style={{
                width: `${chapters ? (chapters.done / chapters.total) * 100 : book.percent}%`,
              }}
            />
          </div>
        )}
        {chapters ? (
          <p className="mt-1 truncate text-muted-foreground text-xs" data-testid="book-chapters">
            {chapters.done} of {chapters.total} chapters
          </p>
        ) : summary && summary.done > 0 ? (
          <p className="mt-1 truncate text-muted-foreground text-xs" data-testid="book-chapters">
            {summary.done} {summary.done === 1 ? "chapter" : "chapters"} done
          </p>
        ) : null}
        {progressLine ? (
          <p className="mt-1 truncate text-muted-foreground text-xs" data-testid="book-progress">
            {progressLine}
          </p>
        ) : null}
        {status ? (
          <p className="mt-1" data-testid="book-status" data-status={status}>
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
              {READING_STATUS_LABELS[status]}
            </span>
          </p>
        ) : null}
        <p className="mt-1 flex items-center gap-1 text-muted-foreground text-xs">
          {book.readStatus === "failed" ? (
            <>
              <AlertTriangleIcon className="size-3" /> Upload failed
            </>
          ) : book.readStatus === "uploading" ? (
            "Uploading…"
          ) : (
            lastOpened(book)
          )}
          {offline ? (
            <span className="ml-auto flex items-center gap-0.5" data-testid="offline-badge">
              <CloudDownloadIcon className="size-3" aria-hidden />
              <span className="sr-only">Available offline</span>
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

function EditDialog({
  book,
  onClose,
  onSave,
}: {
  book: Book | null;
  onClose: () => void;
  onSave: (book: Book, title: string, author: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  useEffect(() => {
    setTitle(book?.title ?? "");
    setAuthor(book?.author ?? "");
  }, [book]);
  return (
    <Dialog open={book !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (book) void onSave(book, title, author).then(onClose);
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit book</DialogTitle>
          </DialogHeader>
          <Input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input aria-label="Author" value={author} onChange={(e) => setAuthor(e.target.value)} />
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
