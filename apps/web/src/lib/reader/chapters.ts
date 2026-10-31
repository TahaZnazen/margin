import type { OutlineItem } from "@margin/reader";

/** A chapter row: an outline entry that points inside the document. */
export interface Chapter {
  title: string;
  /** 0-based page. */
  page: number;
  offsetPt: number;
  depth: number;
}

function walk(items: OutlineItem[], depth: number, out: Chapter[]) {
  for (const item of items) {
    if (item.page !== undefined) {
      out.push({
        title: item.title || "Untitled",
        page: item.page,
        offsetPt: item.offsetPt ?? 0,
        depth,
      });
    }
    walk(item.children, depth + 1, out);
  }
}

/** Every outline entry in document order. */
export function flatChapters(items: OutlineItem[]): Chapter[] {
  const out: Chapter[] = [];
  walk(items, 0, out);
  return out;
}

/**
 * The entries that count as "chapters" for the header, the progress line and the Next chapter
 * control: the top level, plus the second level when the top level is just a few parts.
 */
export function chapterLevel<T extends Chapter>(all: T[]): T[] {
  const top = all.filter((c) => c.depth === 0);
  return top.length >= 6 ? top : all.filter((c) => c.depth <= 1);
}

/** Index of the last chapter starting at or before `page` (-1 before the first). */
export function chapterIndexAt(chapters: readonly Chapter[], page: number): number {
  let found = -1;
  for (let i = 0; i < chapters.length; i++) {
    if ((chapters[i] as Chapter).page <= page) found = i;
    else break;
  }
  return found;
}

/** Share of the current chapter that has been reached, by pages (0..1). */
export function chapterProgress(
  chapters: readonly Chapter[],
  index: number,
  page: number,
  pageCount: number,
): number {
  const cur = chapters[index];
  if (!cur) return 0;
  const end = chapters.slice(index + 1).find((c) => c.page > cur.page)?.page ?? pageCount;
  const span = Math.max(end - cur.page, 1);
  return Math.min(Math.max((page - cur.page + 1) / span, 0), 1);
}

/**
 * The next chapter, once the reader is on the last page before it. Chapters of a single page never
 * offer it (the control would sit there all the time).
 */
export function nextChapterAtEnd<T extends Chapter>(
  chapters: readonly T[],
  index: number,
  page: number,
): T | null {
  const cur = chapters[index];
  if (!cur) return null;
  const next = chapters.slice(index + 1).find((c) => c.page > cur.page);
  if (!next || next.page - cur.page < 2) return null;
  return page >= next.page - 1 ? next : null;
}

/** `#p=<page>` (1-based, as shown in the page indicator) to a 0-based page, or null. */
export function pageFromHash(hash: string, pageCount?: number): number | null {
  const m = /[#&]p=(\d{1,6})(?:&|$)/.exec(hash);
  if (!m) return null;
  const n = Number(m[1]) - 1;
  if (!Number.isFinite(n) || n < 0) return null;
  return pageCount ? Math.min(n, pageCount - 1) : n;
}

export function pageLink(origin: string, documentId: string, page: number): string {
  return `${origin}/app/read/${documentId}#p=${page + 1}`;
}

export const MAX_BOOKMARK_NAME = 80;

/** What a bookmark row shows: its own name (the comment) if set, and where it sits. */
export function bookmarkLabel(
  outline: OutlineItem[],
  page: number,
  comment: string | null | undefined,
): { name: string | null; chapter: string | null; where: string; title: string } {
  const all = flatChapters(outline);
  const chapter = all[chapterIndexAt(all, page)]?.title ?? null;
  const name = comment?.replace(/\s+/g, " ").trim() || null;
  const pageLabel = `p. ${page + 1}`;
  const where = chapter ? `${chapter} · ${pageLabel}` : pageLabel;
  return { name, chapter, where, title: name ?? (chapter ? where : `Page ${page + 1}`) };
}
