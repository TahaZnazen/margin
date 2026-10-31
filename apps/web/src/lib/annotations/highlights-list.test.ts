import { describe, expect, it } from "vitest";
import type { HighlightEntry } from "./annotations-repo";
import {
  booksOf,
  colorCounts,
  filterHighlights,
  fold,
  type HighlightQuery,
} from "./highlights-list";

let n = 0;
function entry(p: Partial<HighlightEntry>): HighlightEntry {
  n += 1;
  return {
    id: `id-${n}`,
    documentId: "d1",
    kind: "highlight",
    color: "key",
    target: {} as HighlightEntry["target"],
    pageStart: 0,
    quoteText: "quote",
    comment: null,
    anchorStatus: "anchored",
    createdAt: `2026-01-01T00:00:${String(n).padStart(2, "0")}Z`,
    updatedAt: "2026-01-01T00:00:00Z",
    bookTitle: "Alpha",
    bookAuthor: null,
    ...p,
  };
}

const q = (p: Partial<HighlightQuery> = {}): HighlightQuery => ({
  text: "",
  colors: new Set(),
  documentId: null,
  includeBookmarks: false,
  sort: "newest",
  ...p,
});
const ids = (list: HighlightEntry[]) => list.map((e) => e.id);

const a1 = entry({ id: "a1", quoteText: "The Résumé of entropy", pageStart: 5 });
const a2 = entry({ id: "a2", color: "definition", comment: "Mind the NOTE", pageStart: 1 });
const b1 = entry({ id: "b1", documentId: "d2", bookTitle: "Beta", color: "key", pageStart: 3 });
const bm = entry({
  id: "bm",
  kind: "bookmark",
  color: null,
  comment: "come back",
  quoteText: null,
});
const all = [a1, a2, b1, bm];

describe("fold", () => {
  it("lowercases and strips accents", () => expect(fold("Résumé ÉCOLE")).toBe("resume ecole"));
});

describe("filterHighlights", () => {
  it("hides bookmarks unless asked", () => {
    expect(ids(filterHighlights(all, q()))).not.toContain("bm");
    expect(ids(filterHighlights(all, q({ includeBookmarks: true })))).toContain("bm");
  });
  it("searches quote, comment and book title, ignoring case and accents", () => {
    expect(ids(filterHighlights(all, q({ text: "resume" })))).toEqual(["a1"]);
    expect(ids(filterHighlights(all, q({ text: "note" })))).toEqual(["a2"]);
    expect(ids(filterHighlights(all, q({ text: "BETA" })))).toEqual(["b1"]);
    expect(filterHighlights(all, q({ text: "zzz" }))).toEqual([]);
  });
  it("filters by color (several = or) and by book", () => {
    expect(ids(filterHighlights(all, q({ colors: new Set(["key"]) }))).sort()).toEqual([
      "a1",
      "b1",
    ]);
    expect(filterHighlights(all, q({ colors: new Set(["key", "definition"]) }))).toHaveLength(3);
    expect(ids(filterHighlights(all, q({ documentId: "d2" })))).toEqual(["b1"]);
  });
  it("a color filter excludes colorless bookmarks", () => {
    const out = filterHighlights(all, q({ colors: new Set(["key"]), includeBookmarks: true }));
    expect(ids(out)).not.toContain("bm");
  });
  it("sorts newest first, or by book then page", () => {
    expect(ids(filterHighlights(all, q()))).toEqual(["b1", "a2", "a1"]);
    expect(ids(filterHighlights(all, q({ sort: "book" })))).toEqual(["a2", "a1", "b1"]);
  });
  it("does not mutate its input", () => {
    const copy = [...all];
    filterHighlights(all, q({ sort: "book" }));
    expect(all).toEqual(copy);
  });
});

describe("colorCounts", () => {
  it("counts under text and book filters but not the color filter", () => {
    expect(colorCounts(all, q()).get("key")).toBe(2);
    expect(colorCounts(all, q({ documentId: "d1" })).get("key")).toBe(1);
    expect(colorCounts(all, q({ colors: new Set(["definition"]) })).get("key")).toBe(2);
    expect(colorCounts(all, q({ text: "entropy" })).get("definition")).toBeUndefined();
  });
});

describe("booksOf", () => {
  it("lists each book once, by title", () => {
    expect(booksOf(all)).toEqual([
      { id: "d1", title: "Alpha" },
      { id: "d2", title: "Beta" },
    ]);
  });
});
