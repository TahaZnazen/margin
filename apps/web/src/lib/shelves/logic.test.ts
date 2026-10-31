import { expect, test } from "vitest";
import { ALL_BOOKS, cleanShelfName, filterByShelf, shelfCounts, shelvesOfBook } from "./logic";
import type { Shelf, ShelfLink } from "./shelves-repo";

const shelf = (id: string): Shelf => ({ id, name: id, sortOrder: 0, createdAt: "" });
const shelves = [shelf("s1"), shelf("s2")];
const links: ShelfLink[] = [
  { shelfId: "s1", documentId: "a" },
  { shelfId: "s1", documentId: "b" },
  { shelfId: "s1", documentId: "b" },
  { shelfId: "s2", documentId: "a" },
  { shelfId: "gone", documentId: "a" },
];
const books = [{ id: "a" }, { id: "b" }, { id: "c" }];

test("counts books once per shelf and ignores unknown shelves", () => {
  expect(shelfCounts(shelves, links)).toEqual(
    new Map([
      ["s1", 2],
      ["s2", 1],
    ]),
  );
});

test("shelvesOfBook lists the shelves of one book", () => {
  expect(shelvesOfBook(links, "a")).toEqual(new Set(["s1", "s2", "gone"]));
});

test("filterByShelf keeps shelf books; all or unknown shelf keeps everything", () => {
  expect(filterByShelf(books, links, "s2", shelves).map((b) => b.id)).toEqual(["a"]);
  expect(filterByShelf(books, links, "s1", shelves).map((b) => b.id)).toEqual(["a", "b"]);
  expect(filterByShelf(books, links, ALL_BOOKS, shelves)).toHaveLength(3);
  expect(filterByShelf(books, links, "deleted", shelves)).toHaveLength(3);
});

test("cleanShelfName trims, collapses spaces, caps, rejects empty", () => {
  expect(cleanShelfName("  Exam   2 ")).toBe("Exam 2");
  expect(cleanShelfName("   ")).toBeNull();
  expect(cleanShelfName("x".repeat(100))).toHaveLength(60);
});
