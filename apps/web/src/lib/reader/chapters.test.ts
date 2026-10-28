import type { OutlineItem } from "@margin/reader";
import { describe, expect, it } from "vitest";
import {
  chapterIndexAt,
  chapterLevel,
  chapterProgress,
  flatChapters,
  nextChapterAtEnd,
  pageFromHash,
  pageLink,
} from "./chapters";

const item = (title: string, page: number | undefined, children: OutlineItem[] = []) => ({
  title,
  page,
  children,
});

describe("chapters", () => {
  const tree = [item("Part I", 0, [item("A", 0), item("B", 4)]), item("Part II", 10)];
  const all = flatChapters(tree);

  it("flattens in document order with depth", () => {
    expect(all.map((c) => [c.title, c.depth])).toEqual([
      ["Part I", 0],
      ["A", 1],
      ["B", 1],
      ["Part II", 0],
    ]);
  });
  it("includes the second level when the top level is short", () => {
    expect(chapterLevel(all)).toHaveLength(4);
  });
  it("finds the current chapter and progress", () => {
    const ch = chapterLevel(all);
    expect(chapterIndexAt(ch, 5)).toBe(2);
    expect(chapterIndexAt(ch, 12)).toBe(3);
    expect(chapterProgress(ch, 2, 7, 20)).toBeCloseTo(4 / 6);
  });
  it("offers the next chapter only on the last page of a chapter", () => {
    const ch = chapterLevel(all);
    expect(nextChapterAtEnd(ch, 2, 5)).toBeNull();
    expect(nextChapterAtEnd(ch, 2, 9)?.title).toBe("Part II");
    expect(nextChapterAtEnd(ch, 3, 19)).toBeNull();
  });
  it("parses and builds page links", () => {
    expect(pageFromHash("#p=3")).toBe(2);
    expect(pageFromHash("#a=x&p=9", 5)).toBe(4);
    expect(pageFromHash("#p=0")).toBeNull();
    expect(pageFromHash("#a=1")).toBeNull();
    expect(pageLink("http://x", "id", 2)).toBe("http://x/app/read/id#p=3");
  });
});
