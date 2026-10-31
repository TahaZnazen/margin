"use client";

import { type OutlineItem, type ReaderDocument, Thumbnails } from "@margin/reader";
import { toast } from "@margin/ui/components/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@margin/ui/components/tabs";
import { cn } from "@margin/ui/lib/utils";
import { ChevronRightIcon, LinkIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Annotation } from "@/lib/annotations/annotations-repo";
import { pageLink } from "@/lib/reader/chapters";
import { formatDuration, secondsLeftInRange } from "@/lib/reader/pace";

export type SidebarTab = "chapters" | "pages" | "bookmarks";
export const SIDEBAR_TABS: readonly SidebarTab[] = ["chapters", "pages", "bookmarks"];

interface Row {
  key: string;
  item: OutlineItem;
  depth: number;
  parent: string | null;
  hasChildren: boolean;
}

/** The outline as rows in document order, each with a stable path key. */
function rowsOf(items: OutlineItem[]): Row[] {
  const out: Row[] = [];
  const walk = (list: OutlineItem[], depth: number, parent: string | null, prefix: string) => {
    list.forEach((item, i) => {
      const key = `${prefix}${i}`;
      out.push({ key, item, depth, parent, hasChildren: item.children.length > 0 });
      walk(item.children, depth + 1, key, `${key}.`);
    });
  };
  walk(items, 0, null, "");
  return out;
}

export interface ReaderSidebarProps {
  documentId: string;
  tab: SidebarTab;
  onTab: (tab: SidebarTab) => void;
  outline: OutlineItem[];
  /** True when `outline` was detected from headings, not read from the PDF. */
  detected: boolean;
  scanning: boolean;
  doc: ReaderDocument | null;
  /** 0-based current page. */
  page: number;
  pageCount: number;
  /** Seconds per page once there is enough reading data; null before. */
  secPerPage: number | null;
  bookmarks: readonly Annotation[];
  onGoTo: (page: number, offsetPt?: number) => void;
  onBookmark: (id: string) => void;
}

export function ReaderSidebar(props: ReaderSidebarProps) {
  const { tab, onTab } = props;
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => onTab(v as SidebarTab)}
      className="h-full min-h-0 gap-0"
      data-testid="reader-sidebar"
    >
      <TabsList className="m-2 mb-1 h-9 shrink-0 self-stretch">
        <TabsTrigger value="chapters" className="h-full">
          Chapters
        </TabsTrigger>
        <TabsTrigger value="pages" className="h-full">
          Pages
        </TabsTrigger>
        <TabsTrigger value="bookmarks" className="h-full">
          Bookmarks
        </TabsTrigger>
      </TabsList>
      <TabsContent value="chapters" className="min-h-0 flex-1 overflow-y-auto pb-4">
        <Chapters {...props} />
      </TabsContent>
      <TabsContent value="pages" className="min-h-0 flex-1 overflow-y-auto">
        <PagesTab {...props} />
      </TabsContent>
      <TabsContent
        value="bookmarks"
        className="min-h-0 flex-1 overflow-y-auto p-2 text-sm"
        data-testid="bookmarks-panel"
      >
        {props.bookmarks.length === 0 ? (
          <p className="p-2 text-muted-foreground">
            No bookmarks yet. Press B to bookmark the page you are on.
          </p>
        ) : (
          <ul>
            {props.bookmarks.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  data-testid="bookmark-item"
                  className="min-h-9 w-full rounded-md px-2 py-1.5 text-left hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => props.onBookmark(b.id)}
                >
                  Page {b.pageStart + 1}
                </button>
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
    </Tabs>
  );
}

function Chapters({
  documentId,
  outline,
  detected,
  scanning,
  page,
  pageCount,
  onGoTo,
  onTab,
  secPerPage,
}: ReaderSidebarProps) {
  const rows = useMemo(() => rowsOf(outline), [outline]);
  const scroller = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  // The deepest entry that starts at or before the current page.
  const currentKey = useMemo(() => {
    let found: string | null = null;
    for (const r of rows) {
      if (r.item.page === undefined) continue;
      if (r.item.page <= page) found = r.key;
      else break;
    }
    return found;
  }, [rows, page]);

  // Time left in the current entry: up to the next entry that starts on a later page.
  const chapterLeft = useMemo(() => {
    const idx = rows.findIndex((r) => r.key === currentKey);
    const cur = rows[idx]?.item.page;
    if (cur === undefined || secPerPage == null) return null;
    const end = rows.slice(idx + 1).find((r) => (r.item.page ?? -1) > cur)?.item.page ?? pageCount;
    const left = secondsLeftInRange(secPerPage, page, end);
    return left === null ? null : `${formatDuration(left)} left`;
  }, [rows, currentKey, page, pageCount, secPerPage]);

  // Ancestors of the current entry stay open, so it is always visible.
  const forced = useMemo(() => {
    const set = new Set<string>();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    let cursor = currentKey ? byKey.get(currentKey)?.parent : null;
    while (cursor) {
      set.add(cursor);
      cursor = byKey.get(cursor)?.parent ?? null;
    }
    return set;
  }, [rows, currentKey]);

  const byKey = new Map(rows.map((x) => [x.key, x]));
  const visible = rows.filter((r) => {
    let parent = r.parent;
    while (parent) {
      if (!open.has(parent) && !forced.has(parent)) return false;
      parent = byKey.get(parent)?.parent ?? null;
    }
    return true;
  });

  // Keep the current chapter in view while the page scrolls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll only when the current entry changes
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>('[data-current="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [currentKey]);

  if (rows.length === 0) {
    return (
      <div className="p-4 text-muted-foreground text-sm" data-testid="chapters-empty">
        {scanning ? (
          <p>Looking for chapter headings…</p>
        ) : (
          <>
            <p className="font-medium text-foreground">This PDF has no table of contents.</p>
            <p className="mt-1">
              You can still jump around from the{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onTab("pages")}
              >
                Pages tab
              </button>
              .
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div ref={scroller}>
      {detected ? (
        <p className="px-3 pb-1 text-muted-foreground text-xs" data-testid="chapters-detected">
          No table of contents in this PDF. These are headings found in the text.
        </p>
      ) : null}
      <nav aria-label="Chapters" data-testid="chapters">
        <ul>
          {visible.map((r) => {
            const isCurrent = r.key === currentKey;
            const expanded = open.has(r.key) || forced.has(r.key);
            const target = r.item.page;
            return (
              <li key={r.key}>
                <div
                  data-testid="chapter-row"
                  data-current={isCurrent ? "true" : undefined}
                  data-page={target === undefined ? undefined : target + 1}
                  className={cn(
                    "group relative flex items-start gap-0.5 border-transparent border-l-2 pr-1 text-sm",
                    isCurrent && "border-primary bg-accent/70 font-medium",
                  )}
                  style={{ paddingLeft: `${0.25 + r.depth * 0.9}rem` }}
                >
                  {r.hasChildren ? (
                    <button
                      type="button"
                      aria-label={expanded ? "Collapse section" : "Expand section"}
                      aria-expanded={expanded}
                      className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() =>
                        setOpen((prev) => {
                          const next = new Set(prev);
                          if (next.has(r.key)) next.delete(r.key);
                          else next.add(r.key);
                          return next;
                        })
                      }
                    >
                      <ChevronRightIcon
                        className={cn("size-4 transition-transform", expanded && "rotate-90")}
                      />
                    </button>
                  ) : (
                    <span className="size-7 shrink-0" aria-hidden />
                  )}
                  <button
                    type="button"
                    disabled={target === undefined}
                    aria-current={isCurrent ? "location" : undefined}
                    className="min-h-9 min-w-0 flex-1 rounded-md py-1.5 pr-1 text-left leading-snug hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    onClick={() => target !== undefined && onGoTo(target, r.item.offsetPt)}
                  >
                    {r.item.title || "Untitled"}
                    {isCurrent && chapterLeft ? (
                      <span
                        className="block font-normal text-muted-foreground text-xs"
                        data-testid="chapter-time-left"
                      >
                        {chapterLeft}
                      </span>
                    ) : null}
                  </button>
                  {target !== undefined ? (
                    <span
                      className="mt-2 shrink-0 text-muted-foreground text-xs tabular-nums"
                      data-testid="chapter-page"
                    >
                      p. {target + 1}
                    </span>
                  ) : null}
                  {target !== undefined ? (
                    <button
                      type="button"
                      data-testid="chapter-copy-link"
                      aria-label={`Copy link to ${r.item.title || "this chapter"}`}
                      title="Copy link"
                      className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-60 hover:bg-accent hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
                      onClick={() => {
                        const url = pageLink(window.location.origin, documentId, target);
                        navigator.clipboard.writeText(url).then(
                          () => toast.success("Link copied"),
                          () => toast.error("Could not copy the link"),
                        );
                      }}
                    >
                      <LinkIcon className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function PagesTab({ doc, page, onGoTo }: ReaderSidebarProps) {
  return (
    <div className="px-2 pb-6">
      <Thumbnails doc={doc} page={page} onSelect={(p) => onGoTo(p)} width={136} />
    </div>
  );
}
