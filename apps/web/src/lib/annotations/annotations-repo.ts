import type {
  AnchorStatus,
  AnnotationKind,
  AnnotationTarget,
  HighlightColor,
} from "@margin/annotation-model";

/**
 * Where annotations live. The UI depends only on this interface: P09 implements it with
 * supabase-js (RLS applies) behind an optimistic store, P06 swaps in PowerSync local SQLite.
 */
export interface Annotation {
  id: string;
  documentId: string;
  kind: Exclude<AnnotationKind, "ink">;
  color: HighlightColor | null;
  target: AnnotationTarget;
  /** The first segment's page, 0-based. */
  pageStart: number;
  quoteText: string | null;
  comment: string | null;
  anchorStatus: AnchorStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationsRepo {
  /** Live (not deleted) annotations of a document. */
  list(documentId: string): Promise<Annotation[]>;
  /** Insert or replace the row (also undeletes it). */
  save(annotation: Annotation): Promise<void>;
  /** Soft delete. */
  remove(id: string): Promise<void>;
  /** Calls `onChange` when the document's annotations change here or on another device. */
  subscribe?(documentId: string, onChange: () => void): () => void;
}

/** An annotation together with the book it belongs to (N3: the all-highlights page). */
export interface HighlightEntry extends Annotation {
  bookTitle: string;
  bookAuthor: string | null;
}

/** Cross-book reads over the local database. Works offline. */
export interface AllHighlightsRepo {
  /**
   * Live highlights of every live book, plus bookmarks that carry a comment. Deleted rows and the
   * rows of deleted books are left out. Unordered: the caller sorts.
   */
  listAll(): Promise<HighlightEntry[]>;
  /** Calls `onChange` when any annotation or book changes here or on another device. */
  subscribeAll(onChange: () => void): () => void;
}
