import type { OutlineItem } from "@margin/reader";

/** Where a chapter mark came from: ticked by the user, or by the opt-in auto-mark setting. */
export type ChapterSource = "manual" | "auto";

/** A chapter that can be ticked: an outline (or guessed heading) row that points at a page. */
export interface ChapterNode {
  /** Stable key stored in `chapter_progress.chapter_key` (ADR 0004). */
  key: string;
  title: string;
  /** 0-based page. */
  page: number;
  offsetPt: number;
  depth: number;
  /** The nearest ancestor that can be ticked. */
  parentKey: string | null;
  /** Direct children that can be ticked. */
  childKeys: string[];
}

/** One chapter row to write. */
export interface ChapterChange {
  key: string;
  title: string;
  page: number;
  done: boolean;
}

/** Lowercase letters and digits joined by hyphens, so small title edits keep a mark. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** `o:<outline path>:<normalized title>` for a real outline, `d:<page>:<title>` for guessed headings. */
export function chapterKey(detected: boolean, path: string, page: number, title: string): string {
  const t = normalizeTitle(title || "untitled") || "untitled";
  return detected ? `d:${page}:${t}` : `o:${path}:${t}`;
}

/**
 * Every outline row that points inside the document, in document order, with the key it is stored
 * under and its place in the tree. `detected` is true for headings found in the text.
 */
export function buildChapterTree(
  outline: readonly OutlineItem[],
  detected: boolean,
): ChapterNode[] {
  const nodes: ChapterNode[] = [];
  const byKey = new Map<string, ChapterNode>();
  const walk = (
    items: readonly OutlineItem[],
    depth: number,
    parentKey: string | null,
    prefix: string,
  ) => {
    items.forEach((item, i) => {
      const path = `${prefix}${i}`;
      let nextParent = parentKey;
      if (item.page !== undefined) {
        const key = chapterKey(detected, path, item.page, item.title);
        // Two guessed headings on one page with the same text would share a key: keep the first.
        if (!byKey.has(key)) {
          const node: ChapterNode = {
            key,
            title: item.title || "Untitled",
            page: item.page,
            offsetPt: item.offsetPt ?? 0,
            depth,
            parentKey,
            childKeys: [],
          };
          nodes.push(node);
          byKey.set(key, node);
          if (parentKey) byKey.get(parentKey)?.childKeys.push(key);
          nextParent = key;
        }
      }
      walk(item.children, depth + 1, nextParent, `${path}.`);
    });
  };
  walk(outline, 0, null, "");
  return nodes;
}

/**
 * The rows that count as "chapters" for the library ("4 of 12 chapters") and for finishing a
 * book: the top level, plus the second level when the top level is just a few parts (the same
 * rule as the reader's chapter header, `chapterLevel`).
 */
export function countedChapters(nodes: readonly ChapterNode[]): ChapterNode[] {
  const top = nodes.filter((n) => n.depth === 0);
  return top.length >= 6 ? top : nodes.filter((n) => n.depth <= 1);
}

/**
 * What ticking `key` changes. A node that is not done becomes done together with all of its
 * descendants; a done node is cleared together with them. Ancestors then follow their children:
 * done exactly when all of their children are. Returns only the rows whose state changes, so one
 * click is one undo step.
 */
export function toggleChanges(
  nodes: readonly ChapterNode[],
  isDone: (key: string) => boolean,
  key: string,
  force?: boolean,
): ChapterChange[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const start = byKey.get(key);
  if (!start) return [];
  const target = force ?? !isDone(key);
  const state = new Map<string, boolean>();
  const get = (k: string) => state.get(k) ?? isDone(k);
  const setTree = (node: ChapterNode) => {
    state.set(node.key, target);
    for (const child of node.childKeys) {
      const c = byKey.get(child);
      if (c) setTree(c);
    }
  };
  setTree(start);
  let parent = start.parentKey ? byKey.get(start.parentKey) : undefined;
  while (parent) {
    state.set(parent.key, parent.childKeys.every(get));
    parent = parent.parentKey ? byKey.get(parent.parentKey) : undefined;
  }
  const changes: ChapterChange[] = [];
  for (const node of nodes) {
    const next = state.get(node.key);
    if (next !== undefined && next !== isDone(node.key)) {
      changes.push({ key: node.key, title: node.title, page: node.page, done: next });
    }
  }
  return changes;
}

/** The changes that put the rows back as they were. */
export const invert = (changes: readonly ChapterChange[]): ChapterChange[] =>
  changes.map((c) => ({ ...c, done: !c.done }));

/** First page after the chapter: the next entry that is not inside it, or the end of the book. */
export function chapterEndPage(
  nodes: readonly ChapterNode[],
  node: ChapterNode,
  pageCount: number,
): number {
  const i = nodes.indexOf(node);
  for (const n of nodes.slice(i + 1)) {
    if (n.depth <= node.depth && n.page > node.page) return n.page;
  }
  return pageCount;
}

/** True when `page` is the chapter's last page (the trigger for "Done & next" and auto-mark). */
export const onLastPageOf = (
  nodes: readonly ChapterNode[],
  node: ChapterNode,
  page: number,
  pageCount: number,
): boolean => pageCount > 0 && page >= chapterEndPage(nodes, node, pageCount) - 1;

/** The outline as the database stores it (JSON text or already parsed), or an empty list. */
export function parseOutline(raw: unknown): OutlineItem[] {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? (value as OutlineItem[]) : [];
}

/** Keys of the counted chapters of a stored outline (real outlines only). */
export const countedKeys = (raw: unknown): string[] =>
  countedChapters(buildChapterTree(parseOutline(raw), false)).map((n) => n.key);

export interface ChapterSummary {
  /** Counted chapters in the outline; 0 when the book has none stored. */
  total: number;
  /** Chapters done: of the counted ones when there are some, else every mark. */
  done: number;
  /** One flag per counted chapter, for the segmented bar. */
  segments: boolean[];
}

export function summarize(
  topKeys: readonly string[],
  doneKeys: ReadonlySet<string>,
): ChapterSummary {
  if (topKeys.length === 0) return { total: 0, done: doneKeys.size, segments: [] };
  const segments = topKeys.map((k) => doneKeys.has(k));
  return { total: topKeys.length, done: segments.filter(Boolean).length, segments };
}

/**
 * 0..100 for sorting: chapters done once any are ticked, else the page percent (a book whose
 * chapters were never ticked still sorts by how far it was read).
 */
export const progressScore = (summary: ChapterSummary | undefined, percent: number): number =>
  summary && summary.total > 0 && summary.done > 0 ? (summary.done / summary.total) * 100 : percent;

/** True when the card should show chapter progress (some chapters ticked in a book with chapters). */
export const hasChapterProgress = (s: ChapterSummary | undefined): s is ChapterSummary =>
  !!s && s.total > 0 && s.done > 0;

/** True when the book has chapters and all of them are done. */
export const allDone = (s: ChapterSummary | undefined): boolean =>
  !!s && s.total > 0 && s.done >= s.total;
