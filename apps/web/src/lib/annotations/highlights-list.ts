import type { HighlightColor } from "@margin/annotation-model";
import type { HighlightEntry } from "./annotations-repo";

export type HighlightSort = "newest" | "book";

export interface HighlightQuery {
  /** Free text: quote, comment and book title. Case and accent insensitive. */
  text: string;
  /** Empty = every color. Bookmarks (no color) never match a non-empty set. */
  colors: ReadonlySet<HighlightColor>;
  /** null = every book. */
  documentId: string | null;
  /** Bookmarks that carry a comment. */
  includeBookmarks: boolean;
  sort: HighlightSort;
}

/** Lowercase, accents removed, so "Résumé" matches "resume". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function matchesText(entry: HighlightEntry, needle: string): boolean {
  if (!needle) return true;
  return fold(`${entry.quoteText ?? ""}\n${entry.comment ?? ""}\n${entry.bookTitle}`).includes(
    needle,
  );
}

function visible(entry: HighlightEntry, includeBookmarks: boolean): boolean {
  return entry.kind === "highlight" || (includeBookmarks && entry.kind === "bookmark");
}

/** Everything except the color filter, so chip counts show what each color would add. */
function base(entries: readonly HighlightEntry[], q: HighlightQuery): HighlightEntry[] {
  const needle = fold(q.text.trim());
  return entries.filter(
    (e) =>
      visible(e, q.includeBookmarks) &&
      (q.documentId === null || e.documentId === q.documentId) &&
      matchesText(e, needle),
  );
}

export function sortEntries(entries: readonly HighlightEntry[], sort: HighlightSort) {
  const out = [...entries];
  if (sort === "newest") {
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  } else {
    out.sort(
      (a, b) =>
        a.bookTitle.localeCompare(b.bookTitle, undefined, { sensitivity: "base" }) ||
        a.documentId.localeCompare(b.documentId) ||
        a.pageStart - b.pageStart ||
        a.createdAt.localeCompare(b.createdAt),
    );
  }
  return out;
}

export function filterHighlights(
  entries: readonly HighlightEntry[],
  q: HighlightQuery,
): HighlightEntry[] {
  const kept = base(entries, q).filter(
    (e) => q.colors.size === 0 || (e.color !== null && q.colors.has(e.color)),
  );
  return sortEntries(kept, q.sort);
}

/** Per-color counts under the current text, book and bookmark settings (not the color filter). */
export function colorCounts(
  entries: readonly HighlightEntry[],
  q: HighlightQuery,
): Map<HighlightColor, number> {
  const out = new Map<HighlightColor, number>();
  for (const e of base(entries, q)) if (e.color) out.set(e.color, (out.get(e.color) ?? 0) + 1);
  return out;
}

/** Books that have at least one entry, for the book filter, by title. */
export function booksOf(entries: readonly HighlightEntry[]): { id: string; title: string }[] {
  const seen = new Map<string, string>();
  for (const e of entries) seen.set(e.documentId, e.bookTitle);
  return [...seen]
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
