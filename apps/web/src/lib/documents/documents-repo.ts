/**
 * Where documents and reading state live. The UI depends only on these interfaces: P08 implements
 * them with supabase-js (RLS applies), P06 swaps in PowerSync without touching the UI.
 */
export type ReadStatus = "uploading" | "readable" | "failed";

export interface Book {
  id: string;
  title: string;
  author: string | null;
  sha256: string;
  byteSize: number | null;
  pageCount: number | null;
  storagePath: string | null;
  coverPath: string | null;
  hasTextLayer: boolean | null;
  readStatus: ReadStatus;
  lastOpenedAt: string | null;
  createdAt: string;
  /** Set once the PDF's own highlights were imported (P11); null = not yet. */
  annotationsImportedAt: string | null;
  /** 0 to 100, from reading_state. */
  percent: number;
  /** 0-based page from reading_state; null = never read. */
  readingPage: number | null;
  /** Seconds actually read (visible and active). */
  secondsRead: number;
}

export interface NewBook {
  id: string;
  title: string;
  sha256: string;
  byteSize: number;
  storagePath: string;
}

export type BookPatch = Partial<{
  title: string;
  author: string | null;
  lastOpenedAt: string;
  coverPath: string | null;
  pageCount: number;
  hasTextLayer: boolean;
  outline: unknown;
}>;

export interface DocumentsRepo {
  list(): Promise<Book[]>;
  get(id: string): Promise<Book | null>;
  findBySha(sha256: string): Promise<Book | null>;
  create(book: NewBook): Promise<void>;
  update(id: string, patch: BookPatch): Promise<void>;
  /** Atomically marks the import as started; false when it was already claimed elsewhere. */
  claimImport(id: string): Promise<boolean>;
  /** Undoes a claim after a failed import so the next open retries. */
  releaseImport(id: string): Promise<void>;
  softDelete(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  /** Calls `onChange` when documents change here or on another device. Returns the unsubscribe. */
  subscribe?(onChange: () => void): () => void;
}

export interface ReadingState {
  page: number;
  offsetPt: number | null;
  zoom: number | null;
  percent: number | null;
  secondsRead: number;
}

export interface ReadingStateRepo {
  get(documentId: string): Promise<ReadingState | null>;
  save(documentId: string, state: ReadingState): Promise<void>;
}
