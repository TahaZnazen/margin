import type { Annotation, AnnotationsRepo } from "./annotations-repo";

/**
 * The document's annotations on the client. Writes apply here first (the UI renders them in the
 * same frame) and reach the repo in the background through a small retry queue (CLAUDE.md
 * principle 1: no user action waits on the network). Undo and redo live here too.
 */
export interface AnnotationSnapshot {
  /** Live annotations, ordered by page then position. */
  items: readonly Annotation[];
  loaded: boolean;
  /** Writes not yet confirmed by the repo. */
  pending: number;
  /** Retries keep failing: show "not saved yet". */
  failing: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

type Entry =
  | { kind: "create"; after: Annotation }
  | { kind: "delete"; before: Annotation }
  | { kind: "update"; before: Annotation; after: Annotation; key?: string; at: number };

export interface StoreOptions {
  retryBaseMs?: number;
  retryMaxMs?: number;
  failingAfter?: number;
  /** Updates with the same key within this window share one undo step (typing a comment). */
  coalesceMs?: number;
}

type Op = "save" | "remove";

const HISTORY_LIMIT = 200;

function order(a: Annotation, b: Annotation): number {
  if (a.pageStart !== b.pageStart) return a.pageStart - b.pageStart;
  const ra = a.target.segments[0].rects[0];
  const rb = b.target.segments[0].rects[0];
  if ((ra?.[1] ?? 0) !== (rb?.[1] ?? 0)) return (ra?.[1] ?? 0) - (rb?.[1] ?? 0);
  return (ra?.[0] ?? 0) - (rb?.[0] ?? 0);
}

export function createAnnotationStore(
  repo: AnnotationsRepo,
  documentId: string,
  options: StoreOptions = {},
) {
  const { retryBaseMs = 1000, retryMaxMs = 15_000, failingAfter = 2, coalesceMs = 2000 } = options;
  const items = new Map<string, Annotation>();
  const pending = new Map<string, Op>();
  const undoStack: Entry[] = [];
  const redoStack: Entry[] = [];
  const listeners = new Set<() => void>();
  let loaded = false;
  let failures = 0;
  let flushing = false;
  let inflight: string | null = null;
  // Ids written locally while a list request is out: that response may predate them.
  const touched = new Set<string>();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const build = (): AnnotationSnapshot => ({
    items: [...items.values()].sort(order),
    loaded,
    pending: pending.size + (inflight ? 1 : 0),
    failing: failures >= failingAfter,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  });
  let snapshot = build();
  const emit = () => {
    snapshot = build();
    for (const listener of listeners) listener();
  };

  async function flush(): Promise<void> {
    if (flushing) return;
    flushing = true;
    clearTimeout(retryTimer);
    try {
      while (pending.size > 0) {
        const [id, op] = pending.entries().next().value as [string, Op];
        pending.delete(id);
        inflight = id;
        const current = items.get(id);
        try {
          if (op === "save" && current) await repo.save(current);
          else if (op === "remove") await repo.remove(id);
          failures = 0;
        } catch {
          failures += 1;
          // A newer write to the same id wins; otherwise put the failed one back.
          if (!pending.has(id)) pending.set(id, op);
          inflight = null;
          emit();
          const delay = Math.min(retryMaxMs, retryBaseMs * 2 ** (failures - 1));
          retryTimer = setTimeout(() => void flush(), delay);
          return;
        }
        inflight = null;
        emit();
      }
    } finally {
      flushing = false;
    }
    if (pending.size > 0 && failures === 0) void flush();
  }

  function queue(id: string, op: Op) {
    pending.set(id, op);
    void flush();
  }

  function push(entry: Entry) {
    undoStack.push(entry);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }

  function put(a: Annotation) {
    items.set(a.id, a);
    touched.add(a.id);
    queue(a.id, "save");
  }

  function drop(id: string) {
    items.delete(id);
    touched.add(id);
    queue(id, "remove");
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    get: (id: string) => items.get(id),

    /** Merges the server's rows in; writes still pending on this device win. */
    async load() {
      touched.clear();
      const rows = await repo.list(documentId);
      const server = new Map(rows.map((row) => [row.id, row]));
      const busy = (id: string) => pending.has(id) || inflight === id || touched.has(id);
      for (const id of [...items.keys()]) if (!(server.has(id) || busy(id))) items.delete(id);
      for (const [id, row] of server) if (!busy(id)) items.set(id, row);
      loaded = true;
      emit();
    },

    create(annotation: Annotation): Annotation {
      put(annotation);
      push({ kind: "create", after: annotation });
      emit();
      return annotation;
    },

    update(id: string, patch: Partial<Pick<Annotation, "color" | "comment">>, key?: string) {
      const before = items.get(id);
      if (!before) return;
      const after: Annotation = { ...before, ...patch, updatedAt: new Date().toISOString() };
      put(after);
      const last = undoStack.at(-1);
      const now = Date.now();
      if (
        key &&
        last?.kind === "update" &&
        last.key === key &&
        last.after.id === id &&
        now - last.at < coalesceMs
      ) {
        last.after = after;
        last.at = now;
        redoStack.length = 0;
      } else {
        push({ kind: "update", before, after, key, at: now });
      }
      emit();
    },

    remove(id: string) {
      const before = items.get(id);
      if (!before) return;
      drop(id);
      push({ kind: "delete", before });
      emit();
    },

    undo(): Annotation | null {
      const entry = undoStack.pop();
      if (!entry) return null;
      redoStack.push(entry);
      let result: Annotation;
      if (entry.kind === "create") {
        drop(entry.after.id);
        result = entry.after;
      } else {
        result = entry.before;
        put(entry.before);
      }
      emit();
      return result;
    },

    redo(): Annotation | null {
      const entry = redoStack.pop();
      if (!entry) return null;
      undoStack.push(entry);
      let result: Annotation;
      if (entry.kind === "delete") {
        result = entry.before;
        drop(entry.before.id);
      } else {
        result = entry.after;
        put(entry.after);
      }
      emit();
      return result;
    },

    flush,
  };
}

export type AnnotationStore = ReturnType<typeof createAnnotationStore>;

const stores = new Map<string, AnnotationStore>();

/** One store per document for the life of the tab, so a quick reopen sees unsaved writes. */
export function annotationStoreFor(repo: AnnotationsRepo, documentId: string): AnnotationStore {
  let store = stores.get(documentId);
  if (!store) {
    store = createAnnotationStore(repo, documentId);
    stores.set(documentId, store);
  }
  return store;
}
