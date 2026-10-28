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
