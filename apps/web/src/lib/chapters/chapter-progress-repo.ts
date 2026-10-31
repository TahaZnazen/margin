import type { ChapterChange, ChapterSource, ChapterSummary } from "./progress";

/** A chapter that is currently done. */
export interface DoneChapter {
  key: string;
  source: ChapterSource;
}

/**
 * Where chapter marks live (ADR 0004). Un-marking sets `done_at` to null; rows are never
 * soft-deleted for it, so last-write-wins per row stays clean.
 */
export interface ChapterProgressRepo {
  /** The chapters of one book that are done. */
  doneForDocument(documentId: string): Promise<DoneChapter[]>;
  /** Writes the given rows in one local transaction (one undo step). Idempotent. */
  apply(
    documentId: string,
    changes: readonly ChapterChange[],
    source: ChapterSource,
  ): Promise<void>;
  /** Per book: top-level chapters (from the stored outline) and how many are done. */
  summaries(): Promise<Map<string, ChapterSummary>>;
  /** Calls `onChange` when marks change here or on another device. Returns the unsubscribe. */
  subscribe(onChange: () => void): () => void;
}
