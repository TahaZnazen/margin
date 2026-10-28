import { PowerSyncDatabase } from "@powersync/web";
import { ClientSchema } from "./client-schema";

/** The pre-bundled PowerSync workers (`powersync-web copy-assets`, run by the web app's dev/build scripts). */
const WORKER = "/@powersync/worker.js";

let instance: PowerSyncDatabase | undefined;

/**
 * The one local database of this browser profile (SQLite on OPFS/IndexedDB in a shared worker,
 * so every tab shares it). Browser only: never call during server rendering.
 */
export function getSyncDatabase(): PowerSyncDatabase {
  if (typeof window === "undefined")
    throw new Error("The sync database only exists in the browser.");
  if (!instance) {
    instance = new PowerSyncDatabase({
      schema: ClientSchema,
      database: { dbFilename: "margin.db", worker: WORKER, enableMultiTabs: true },
      sync: { worker: WORKER },
    });
  }
  return instance;
}

let readyResolve: (() => void) | undefined;
let ready = new Promise<void>((resolve) => {
  readyResolve = resolve;
});

/** Resolves once the provider has checked whose data the local database holds. Repos await it. */
export function syncReady(): Promise<PowerSyncDatabase> {
  return ready.then(getSyncDatabase);
}

export function markSyncReady(): void {
  readyResolve?.();
}

/** Called on sign-out: the next sign-in must wait for its own readiness check. */
export function resetSyncReady(): void {
  ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
}

let currentUser: string | null = null;

/** The signed-in user's id, set by `SyncProvider`. Local writes stamp it into `user_id` (no network needed). */
export function setSyncUserId(userId: string | null): void {
  currentUser = userId;
}

export function syncUserId(): string {
  if (!currentUser) throw new Error("Not signed in.");
  return currentUser;
}

/**
 * The database for a read. On a device that has never synced, waits (briefly) for the first sync
 * so a returning user doesn't see an empty library for a moment.
 */
export async function syncedForRead(): Promise<PowerSyncDatabase> {
  const db = await syncReady();
  if (!db.currentStatus.hasSynced && (typeof navigator === "undefined" || navigator.onLine)) {
    await Promise.race([
      db.waitForFirstSync().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
  }
  return db;
}

/** Calls `onChange` whenever one of the tables changes (local or synced). Returns the unsubscribe. */
export function watchTables(tables: string[], onChange: () => void): () => void {
  let cancelled = false;
  let dispose: (() => void) | undefined;
  void syncReady().then((db) => {
    if (cancelled) return;
    dispose = db.onChange({ onChange }, { tables, throttleMs: 50 });
  });
  return () => {
    cancelled = true;
    dispose?.();
  };
}

let unsynced = 0;
const unsyncedListeners = new Set<() => void>();

/** Local writes that have not reached the server yet. */
export const unsyncedStore = {
  subscribe(listener: () => void) {
    unsyncedListeners.add(listener);
    return () => {
      unsyncedListeners.delete(listener);
    };
  },
  get: () => unsynced,
};

/**
 * Re-reads the upload queue size. Repos await this at the end of every write, so the count is
 * already up to date when the write resolves; the provider also calls it as uploads finish.
 */
export async function refreshUnsynced(): Promise<void> {
  const db = await syncReady();
  const { count } = await db.getUploadQueueStats();
  if (count === unsynced) return;
  unsynced = count;
  for (const listener of unsyncedListeners) listener();
}

type Params = (string | number | null)[];

/**
 * The database for a write. Each write also refreshes the unsynced count before it resolves, so
 * "nothing pending" can never be read between a write and its entry in the upload queue.
 */
export async function writableDb() {
  const db = await syncReady();
  return {
    async execute(sql: string, params?: Params) {
      const result = await db.execute(sql, params);
      await refreshUnsynced();
      return result;
    },
    async writeTransaction<T>(callback: Parameters<typeof db.writeTransaction<T>>[0]): Promise<T> {
      const result = await db.writeTransaction(callback);
      await refreshUnsynced();
      return result;
    },
  };
}

/**
 * Waits until every local write has reached the server, or `timeoutMs` passes. Used before
 * calling a server endpoint that expects the row to exist in Postgres.
 */
export async function waitForUploads(timeoutMs = 10_000): Promise<boolean> {
  const db = await syncReady();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const stats = await db.getUploadQueueStats();
    if (stats.count === 0) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
}
