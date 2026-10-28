import type { OutlineItem } from "@margin/reader";

/** First page of an outline item, or of its first descendant that has one. */
function startPage(item: OutlineItem): number | undefined {
  if (item.page !== undefined) return item.page;
  for (const child of item.children) {
    const p = startPage(child);
    if (p !== undefined) return p;
  }
  return undefined;
}

export interface Group<T> {
  title: string | null;
  items: T[];
}

/**
 * Groups items (already in page order) by the top-level outline chapter they fall in. Without a
 * usable outline everything is one untitled group.
 */
export function groupByChapter<T extends { pageStart: number }>(
  items: readonly T[],
  outline: readonly OutlineItem[],
): Group<T>[] {
  const chapters = outline
    .map((o) => ({ title: o.title, page: startPage(o) }))
    .filter((c): c is { title: string; page: number } => c.page !== undefined)
    .sort((a, b) => a.page - b.page);
  if (chapters.length === 0) return items.length ? [{ title: null, items: [...items] }] : [];
  const groups: Group<T>[] = [];
  for (const item of items) {
    let title = "Before the first chapter";
    for (const c of chapters) if (c.page <= item.pageStart) title = c.title;
    const last = groups.at(-1);
    if (last?.title === title) last.items.push(item);
    else groups.push({ title, items: [item] });
  }
  return groups;
}
