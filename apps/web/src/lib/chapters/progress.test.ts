import type { OutlineItem } from "@margin/reader";
import { describe, expect, it } from "vitest";
import {
  allDone,
  buildChapterTree,
  chapterEndPage,
  chapterKey,
  countedChapters,
  countedKeys,
  invert,
  normalizeTitle,
  onLastPageOf,
  progressScore,
  summarize,
  toggleChanges,
} from "./progress";

const item = (
  title: string,
  page: number | undefined,
  children: OutlineItem[] = [],
): OutlineItem => ({ title, page, children });

const outline: OutlineItem[] = [
  item("Part I", 0, [item("One", 0), item("Two", 4), item("Three", 8)]),
  item("Part II", 12, [item("Four", 12)]),
  item("Epilogue", 20),
];

describe("chapter keys", () => {
  it("normalizes titles", () => {
    expect(normalizeTitle("  Chapter 3: Café Society! ")).toBe("chapter-3-cafe-society");
  });
  it("uses the outline path or the page", () => {
    expect(chapterKey(false, "3.1", 9, "Preliminaries")).toBe("o:3.1:preliminaries");
    expect(chapterKey(true, "3.1", 9, "Preliminaries")).toBe("d:9:preliminaries");
  });
});

describe("buildChapterTree", () => {
  const nodes = buildChapterTree(outline, false);
  it("lists rows in order with parents and children", () => {
    expect(nodes.map((n) => n.key)).toEqual([
      "o:0:part-i",
      "o:0.0:one",
      "o:0.1:two",
      "o:0.2:three",
      "o:1:part-ii",
      "o:1.0:four",
      "o:2:epilogue",
    ]);
    expect(nodes[0]?.childKeys).toEqual(["o:0.0:one", "o:0.1:two", "o:0.2:three"]);
    expect(nodes[2]?.parentKey).toBe("o:0:part-i");
    // Fewer than six top-level entries: the second level counts as chapters too.
    expect(countedChapters(nodes).map((n) => n.title)).toEqual([
      "Part I",
      "One",
      "Two",
      "Three",
      "Part II",
      "Four",
      "Epilogue",
    ]);
    const many = buildChapterTree(
      ["a", "b", "c", "d", "e", "f"].map((t, i) => item(t, i, [item(`${t}1`, i)])),
      false,
    );
    expect(countedChapters(many).map((n) => n.title)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
  it("skips rows without a page but keeps their children reachable", () => {
    const tree = buildChapterTree([item("Group", undefined, [item("Inner", 3)])], false);
    expect(tree.map((n) => [n.key, n.parentKey])).toEqual([["o:0.0:inner", null]]);
  });
  it("keys guessed headings by page", () => {
    expect(buildChapterTree([item("Intro", 2)], true)[0]?.key).toBe("d:2:intro");
  });
  it("reads counted keys from stored outline JSON", () => {
    expect(countedKeys(JSON.stringify(outline))).toHaveLength(7);
    expect(countedKeys(JSON.stringify(outline))[0]).toBe("o:0:part-i");
    expect(countedKeys(null)).toEqual([]);
    expect(countedKeys("not json")).toEqual([]);
  });
});

describe("toggleChanges", () => {
  const nodes = buildChapterTree(outline, false);
  const doneSet = (...keys: string[]) => {
    const s = new Set(keys);
    return (k: string) => s.has(k);
  };

  it("checking a parent checks its children", () => {
    const changes = toggleChanges(nodes, doneSet(), "o:0:part-i");
    expect(changes.map((c) => c.key)).toEqual([
      "o:0:part-i",
      "o:0.0:one",
      "o:0.1:two",
      "o:0.2:three",
    ]);
    expect(changes.every((c) => c.done)).toBe(true);
  });
  it("a parent becomes done when its last child is", () => {
    const changes = toggleChanges(nodes, doneSet("o:0.0:one", "o:0.1:two"), "o:0.2:three");
    expect(changes.map((c) => [c.key, c.done])).toEqual([
      ["o:0:part-i", true],
      ["o:0.2:three", true],
    ]);
  });
  it("a partly done parent is checked wholly", () => {
    const changes = toggleChanges(nodes, doneSet("o:0.0:one"), "o:0:part-i");
    expect(changes.map((c) => c.key)).toEqual(["o:0:part-i", "o:0.1:two", "o:0.2:three"]);
  });
  it("un-checking a child un-checks the parent", () => {
    const all = ["o:0:part-i", "o:0.0:one", "o:0.1:two", "o:0.2:three"];
    const changes = toggleChanges(nodes, doneSet(...all), "o:0.1:two");
    expect(changes.map((c) => [c.key, c.done])).toEqual([
      ["o:0:part-i", false],
      ["o:0.1:two", false],
    ]);
  });
  it("un-checking a parent clears everything below it", () => {
    const all = ["o:0:part-i", "o:0.0:one", "o:0.1:two", "o:0.2:three"];
    expect(toggleChanges(nodes, doneSet(...all), "o:0:part-i")).toHaveLength(4);
  });
  it("the inverse puts the rows back", () => {
    const changes = toggleChanges(nodes, doneSet(), "o:0:part-i");
    expect(invert(changes).every((c) => !c.done)).toBe(true);
  });
  it("force marks done and ignores a row that is already done", () => {
    expect(toggleChanges(nodes, doneSet("o:2:epilogue"), "o:2:epilogue", true)).toEqual([]);
    expect(toggleChanges(nodes, doneSet(), "o:2:epilogue", true)).toHaveLength(1);
    expect(toggleChanges(nodes, doneSet(), "nope")).toEqual([]);
  });
});

describe("chapter ends", () => {
  const nodes = buildChapterTree(outline, false);
  const two = nodes[2];
  const partI = nodes[0];
  const last = nodes[6];
  it("ends where the next entry that is not inside it starts", () => {
    expect(two && chapterEndPage(nodes, two, 30)).toBe(8);
    expect(partI && chapterEndPage(nodes, partI, 30)).toBe(12);
    expect(last && chapterEndPage(nodes, last, 30)).toBe(30);
  });
  it("knows the last page", () => {
    expect(two && onLastPageOf(nodes, two, 7, 30)).toBe(true);
    expect(two && onLastPageOf(nodes, two, 6, 30)).toBe(false);
  });
});

describe("summaries", () => {
  const keys = ["a", "b", "c", "d"];
  it("counts top-level chapters", () => {
    const s = summarize(keys, new Set(["a", "c", "zzz"]));
    expect(s).toEqual({ total: 4, done: 2, segments: [true, false, true, false] });
    expect(allDone(s)).toBe(false);
    expect(allDone(summarize(keys, new Set(keys)))).toBe(true);
  });
  it("counts marks when the book has no stored outline", () => {
    const s = summarize([], new Set(["d:1:x", "d:2:y"]));
    expect(s.done).toBe(2);
    expect(allDone(s)).toBe(false);
  });
  it("sorts by chapters done when available, else by percent", () => {
    expect(progressScore(summarize(keys, new Set(["a"])), 90)).toBe(25);
    expect(progressScore(undefined, 40)).toBe(40);
    expect(progressScore(summarize([], new Set()), 40)).toBe(40);
    expect(progressScore(summarize(keys, new Set()), 40)).toBe(40);
  });
});
