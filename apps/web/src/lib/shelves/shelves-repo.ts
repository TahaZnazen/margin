/** Shelves: user-made collections of books. A book can be on many shelves. */
export interface Shelf {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
}

/** A book on a shelf. Only live links to live shelves and live books are listed. */
export interface ShelfLink {
  shelfId: string;
  documentId: string;
}

export interface ShelvesRepo {
  list(): Promise<Shelf[]>;
  links(): Promise<ShelfLink[]>;
  create(name: string): Promise<Shelf>;
  rename(id: string, name: string): Promise<void>;
  /** Soft-deletes the shelf and its links (books stay). Returns the link ids, for `restore`. */
  softDelete(id: string): Promise<string[]>;
  /** Undoes `softDelete`: the shelf and exactly the links it removed. */
  restore(id: string, linkIds: string[]): Promise<void>;
  /** Puts a book on a shelf or takes it off. Idempotent. */
  setMember(shelfId: string, documentId: string, member: boolean): Promise<void>;
  /** Calls `onChange` when shelves change here or on another device. Returns the unsubscribe. */
  subscribe(onChange: () => void): () => void;
}
