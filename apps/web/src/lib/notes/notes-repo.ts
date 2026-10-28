/** Where notes live. The UI depends only on this interface; P06 swaps the implementation. */
export interface Note {
  id: string;
  /** null = a standalone note. */
  documentId: string | null;
  title: string | null;
  /** Tiptap JSON. */
  docJson: unknown;
  plainText: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotesRepo {
  /** The book's notebook, or null when it has none yet. */
  getForDocument(documentId: string): Promise<Note | null>;
  list(): Promise<Note[]>;
  get(id: string): Promise<Note | null>;
  /** Insert or replace (also undeletes). */
  save(note: Note): Promise<void>;
  /** Soft delete. */
  remove(id: string): Promise<void>;
}
