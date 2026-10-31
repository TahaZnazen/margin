import type { Shelf, ShelfLink } from "./shelves-repo";

export const ALL_BOOKS = "all";
const STORAGE_KEY = "margin:library-shelf";
const EVENT = "margin:shelf-select";
export const MAX_SHELF_NAME = 60;

/** Books per shelf id; a book counts once per shelf even if linked twice. */
export function shelfCounts(shelves: Shelf[], links: ShelfLink[]): Map<string, number> {
  const seen = new Map<string, Set<string>>(shelves.map((s) => [s.id, new Set<string>()]));
  for (const l of links) seen.get(l.shelfId)?.add(l.documentId);
  return new Map([...seen].map(([id, docs]) => [id, docs.size]));
}

/** Shelves a book is on. */
export function shelvesOfBook(links: ShelfLink[], documentId: string): Set<string> {
  return new Set(links.filter((l) => l.documentId === documentId).map((l) => l.shelfId));
}

/** Keeps the books on the shelf; `ALL_BOOKS` (or an unknown shelf) keeps everything. */
export function filterByShelf<T extends { id: string }>(
  books: T[],
  links: ShelfLink[],
  shelfId: string,
  shelves: Shelf[],
): T[] {
  if (shelfId === ALL_BOOKS || !shelves.some((s) => s.id === shelfId)) return books;
  const ids = new Set(links.filter((l) => l.shelfId === shelfId).map((l) => l.documentId));
  return books.filter((b) => ids.has(b.id));
}

/** A shelf name as stored: trimmed, single-spaced, capped. Null when empty. */
export function cleanShelfName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ").slice(0, MAX_SHELF_NAME);
  return name === "" ? null : name;
}

export function readSelectedShelf(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || ALL_BOOKS;
  } catch {
    return ALL_BOOKS;
  }
}

/** Remembers the shelf on this device and tells a mounted library to switch. */
export function selectShelf(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private mode or blocked storage: the choice just is not remembered.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
}

export function onShelfSelected(handler: (id: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
