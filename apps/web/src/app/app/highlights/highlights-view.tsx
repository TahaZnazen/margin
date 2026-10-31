"use client";

import { HIGHLIGHT_COLORS, type HighlightColor } from "@margin/annotation-model";
import { Input } from "@margin/ui/components/input";
import { cn } from "@margin/ui/lib/utils";
import { BookmarkIcon } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import type { HighlightEntry } from "@/lib/annotations/annotations-repo";
import {
  booksOf,
  colorCounts,
  filterHighlights,
  type HighlightQuery,
  type HighlightSort,
  highlightTagFacets,
} from "@/lib/annotations/highlights-list";
import { useAllHighlights, useHighlightLabels } from "@/lib/annotations/use-all-highlights";

/** Small tag chips under a highlight's text. */
function TagChips({ tags, testId }: { tags: readonly string[]; testId: string }) {
  if (tags.length === 0) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1" data-testid={testId}>
      {tags.map((t) => (
        <span key={t} className="rounded-full bg-accent px-2 py-0.5 text-xs" data-testid="hl-tag">
          #{t}
        </span>
      ))}
    </span>
  );
}

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring";

function Item({ a, labels }: { a: HighlightEntry; labels: Record<HighlightColor, string> }) {
  const label = a.color ? labels[a.color] : "Bookmark";
  return (
    <li
      data-testid="hl-item"
      data-annotation-id={a.id}
      data-color={a.color ?? undefined}
      className="[contain-intrinsic-size:auto_120px] [content-visibility:auto]"
    >
      <Link
        href={`/app/read/${a.documentId}#a=${a.id}`}
        className="flex gap-3 rounded-md border bg-card p-3 text-left text-sm hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className="w-1 shrink-0 self-stretch rounded-full"
          style={{ background: a.color ? `var(--hl-${a.color}-chip)` : "var(--border)" }}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-muted-foreground text-xs">
            {a.color ? null : <BookmarkIcon className="size-3" aria-hidden />}
            <span data-testid="hl-label">{label}</span>
            <span className="ml-auto tabular-nums">p. {a.pageStart + 1}</span>
          </span>
          {a.quoteText ? (
            <span className="mt-1 line-clamp-4 block font-serif" data-testid="hl-quote">
              {a.quoteText}
            </span>
          ) : null}
          {a.comment ? (
            <span
              className="mt-1 line-clamp-3 block text-muted-foreground"
              data-testid="hl-comment"
            >
              {a.comment}
            </span>
          ) : null}
          <TagChips tags={a.tags} testId="hl-tags" />
          <span
            className="mt-1.5 block truncate text-muted-foreground text-xs"
            data-testid="hl-book"
          >
            {a.bookTitle}
            {a.bookAuthor ? ` · ${a.bookAuthor}` : ""}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function HighlightsView() {
  const entries = useAllHighlights();
  const labels = useHighlightLabels();
  const [text, setText] = useState("");
  // Filtering a large library runs per keystroke; deferring it keeps typing responsive.
  const query = useDeferredValue(text);
  const [colors, setColors] = useState<ReadonlySet<HighlightColor>>(new Set());
  const [tags, setTags] = useState<ReadonlySet<string>>(new Set());
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [includeBookmarks, setIncludeBookmarks] = useState(false);
  const [sort, setSort] = useState<HighlightSort>("newest");

  const books = useMemo(() => booksOf(entries ?? []), [entries]);
  // A book whose highlights are all gone must not leave a dead filter behind.
  const bookFilter = documentId && books.some((b) => b.id === documentId) ? documentId : null;
  const shown = useMemo(
    () =>
      filterHighlights(entries ?? [], {
        text: query,
        colors,
        tags,
        documentId: bookFilter,
        includeBookmarks,
        sort,
      } satisfies HighlightQuery),
    [entries, query, colors, tags, bookFilter, includeBookmarks, sort],
  );
  const counts = useMemo(
    () =>
      colorCounts(entries ?? [], {
        text: query,
        colors,
        tags,
        documentId: bookFilter,
        includeBookmarks,
        sort,
      }),
    [entries, query, colors, tags, bookFilter, includeBookmarks, sort],
  );
  const tagChips = useMemo(
    () =>
      highlightTagFacets(entries ?? [], {
        text: query,
        colors,
        tags,
        documentId: bookFilter,
        includeBookmarks,
        sort,
      }),
    [entries, query, colors, tags, bookFilter, includeBookmarks, sort],
  );
  const hasBookmarks = (entries ?? []).some((e) => e.kind === "bookmark");

  const toggle = (c: HighlightColor) =>
    setColors((prev) => {
      const next = new Set(prev);
      if (!next.delete(c)) next.add(c);
      return next;
    });

  const toggleTag = (t: string) =>
    setTags((prev) => {
      const next = new Set(prev);
      if (!next.delete(t)) next.add(t);
      return next;
    });

  if (entries === null) {
    return <p className="text-muted-foreground text-sm">Loading your highlights…</p>;
  }
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm" data-testid="hl-empty">
        No highlights yet — select text in a book and press 1–5.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Search quotes, comments, tags and books"
          aria-label="Search highlights"
          data-testid="hl-search"
          className="min-w-48 flex-1 sm:max-w-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <select
          aria-label="Book"
          data-testid="hl-book-filter"
          className={cn(selectClass, "max-w-full sm:max-w-56")}
          value={bookFilter ?? ""}
          onChange={(e) => setDocumentId(e.target.value || null)}
        >
          <option value="">All books</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort by"
          data-testid="hl-sort"
          className={selectClass}
          value={sort}
          onChange={(e) => setSort(e.target.value as HighlightSort)}
        >
          <option value="newest">Newest first</option>
          <option value="book">Book order</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <fieldset
          className="m-0 flex min-w-0 flex-wrap gap-1 border-0 p-0"
          aria-label="Filter by color"
        >
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              data-testid={`hl-filter-${c}`}
              aria-pressed={colors.has(c)}
              title={labels[c]}
              aria-label={`${labels[c]}, ${counts.get(c) ?? 0}`}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs focus-visible:ring-2 focus-visible:ring-ring",
                colors.has(c) && "bg-accent ring-1 ring-foreground/30",
              )}
              onClick={() => toggle(c)}
            >
              <span
                className="size-2.5 rounded-full"
                style={{ background: `var(--hl-${c}-chip)` }}
              />
              <span data-testid={`hl-count-${c}`}>{counts.get(c) ?? 0}</span>
            </button>
          ))}
        </fieldset>
        {hasBookmarks ? (
          <label className="ml-2 inline-flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              data-testid="hl-bookmarks"
              checked={includeBookmarks}
              onChange={(e) => setIncludeBookmarks(e.target.checked)}
            />
            Bookmarks with a comment
          </label>
        ) : null}
      </div>
      {tagChips.length > 0 ? (
        <fieldset
          className="m-0 flex min-w-0 flex-wrap gap-1 border-0 p-0"
          aria-label="Filter by tag"
          data-testid="hl-tag-filters"
        >
          {tagChips.map(({ tag, count }) => (
            <button
              key={tag}
              type="button"
              data-testid={`hl-tag-filter-${tag}`}
              aria-pressed={tags.has(tag)}
              aria-label={`Tag ${tag}, ${count}`}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs focus-visible:ring-2 focus-visible:ring-ring",
                tags.has(tag) && "bg-accent ring-1 ring-foreground/30",
              )}
              onClick={() => toggleTag(tag)}
            >
              #{tag}
              <span className="text-muted-foreground tabular-nums">{count}</span>
            </button>
          ))}
        </fieldset>
      ) : null}
      <p className="text-muted-foreground text-xs" aria-live="polite" data-testid="hl-total">
        {shown.length} {shown.length === 1 ? "highlight" : "highlights"}
      </p>
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="hl-none">
          No highlights match.
        </p>
      ) : (
        <ul className="space-y-1.5" data-testid="hl-list">
          {shown.map((a) => (
            <Item key={a.id} a={a} labels={labels} />
          ))}
        </ul>
      )}
    </div>
  );
}
