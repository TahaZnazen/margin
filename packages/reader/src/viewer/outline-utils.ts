import type { OutlineItem } from "../engine";

/** Outline items that point at a page, in document order, children after their parent. */
export function flattenOutline(items: OutlineItem[]): (OutlineItem & { page: number })[] {
  const out: (OutlineItem & { page: number })[] = [];
  const walk = (list: OutlineItem[]) => {
    for (const item of list) {
      if (item.page !== undefined) out.push(item as OutlineItem & { page: number });
      walk(item.children);
    }
  };
  walk(items);
  return out;
}

/** The last outline item that starts at or before `page`. */
export function currentChapter(items: OutlineItem[], page: number): OutlineItem | undefined {
  let found: OutlineItem | undefined;
  for (const item of flattenOutline(items)) {
    if (item.page <= page) found = item;
    else break;
  }
  return found;
}
