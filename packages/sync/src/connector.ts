import {
  type AbstractPowerSyncDatabase,
  type CrudEntry,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
  UpdateType,
} from "@powersync/common";
import type { SupabaseClient } from "@supabase/supabase-js";
import { backoffMs, isTransient, type UploadFailure } from "./errors";
import { AppSchema } from "./schema";

/** Every synced column per table. A PUT omits columns that are NULL locally, so they must be re-added as null. */
const COLUMNS = new Map(AppSchema.tables.map((t) => [t.name, t.columns.map((c) => c.name)]));

/** Columns that are `jsonb` in Postgres: stored as JSON text locally, sent as JSON values. */
const JSON_COLUMNS: Record<string, readonly string[]> = {
  documents: ["outline"],
  annotations: ["target", "tags"],
  notes: ["doc_json"],
  user_settings: ["highlight_labels", "reader_prefs"],
};
/** Columns that are `boolean` in Postgres (SQLite keeps 0/1). */
const BOOLEAN_COLUMNS: Record<string, readonly string[]> = { documents: ["has_text_layer"] };

const BATCH = 100;
const UPLOAD_LOCK = "margin-sync-upload";

/** Local SQLite values to the JSON shapes PostgREST expects. */
export function toRemote(
  table: string,
  data: Record<string, unknown>,
  fillNulls = false,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  if (fillNulls) for (const col of COLUMNS.get(table) ?? []) if (!(col in out)) out[col] = null;
  for (const col of JSON_COLUMNS[table] ?? []) {
    const v = out[col];
    if (typeof v === "string") {
      try {
        out[col] = JSON.parse(v);
      } catch {
        // Not valid JSON: send as is and let the database reject it for good.
      }
    }
  }
  for (const col of BOOLEAN_COLUMNS[table] ?? []) {
    const v = out[col];
    if (v === 0 || v === 1) out[col] = v === 1;
  }
  return out;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      if (typeof window !== "undefined") window.removeEventListener("online", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    // Coming back online cuts the wait short.
    if (typeof window !== "undefined") window.addEventListener("online", done);
  });

type Failure = UploadFailure & { message: string };
type Outcome = PromiseLike<{
  error: { code?: string; message: string } | null;
  status: number;
}>;

/**
 * PowerSync upload connector over supabase-js. `fetchCredentials` hands PowerSync the Supabase
 * session token; `uploadData` replays the local CRUD queue (RLS and constraints validate it).
 */
export class SupabaseConnector implements PowerSyncBackendConnector {
  private failures = 0;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly endpoint: string,
  ) {}

  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const { data, error } = await this.supabase.auth.getSession();
    if (error || !data.session) return null;
    return {
      endpoint: this.endpoint,
      token: data.session.access_token,
      expiresAt: data.session.expires_at ? new Date(data.session.expires_at * 1000) : undefined,
    };
  }

  /**
   * One upload at a time across every tab (Web Locks), and within a tab. Two overlapping uploads
   * would both read the same queue head and could send a row's insert after its delete.
   */
  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const run = () => this.upload(database);
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (locks) await locks.request(UPLOAD_LOCK, run);
    else await run();
  }

  private async upload(database: AbstractPowerSyncDatabase): Promise<void> {
    for (;;) {
      const batch = await database.getCrudBatch(BATCH);
      if (!batch) return;
      try {
        await this.apply(database, batch.crud);
      } catch (error) {
        this.failures += 1;
        await sleep(backoffMs(this.failures));
        throw error; // PowerSync retries the batch
      }
      this.failures = 0;
      await batch.complete();
      if (!batch.haveMore) return;
    }
  }

  private async apply(database: AbstractPowerSyncDatabase, ops: CrudEntry[]): Promise<void> {
    let i = 0;
    while (i < ops.length) {
      const first = ops[i];
      if (!first) break;
      // Consecutive PUTs to one table go up as a single upsert.
      let end = i + 1;
      if (first.op === UpdateType.PUT) {
        while (ops[end]?.op === UpdateType.PUT && ops[end]?.table === first.table) end += 1;
      }
      const group = ops.slice(i, end);
      i = end;
      if (group.length > 1) {
        const failure = await this.attempt(() => this.upsert(group));
        if (!failure) continue;
        if (isTransient(failure)) throw new Error(failure.message);
        // Something in the group is bad for good: find it one row at a time.
      }
      for (const entry of group) {
        const failure = await this.attempt(() => this.one(entry));
        if (!failure) continue;
        if (isTransient(failure)) throw new Error(failure.message);
        await this.recordPermanent(database, entry, failure);
      }
    }
  }

  private async attempt(fn: () => Outcome): Promise<Failure | null> {
    try {
      const { error, status } = await fn();
      return error ? { code: error.code, message: error.message, status } : null;
    } catch (thrown) {
      // fetch rejected: the network is down.
      return { message: thrown instanceof Error ? thrown.message : String(thrown), status: 0 };
    }
  }

  private upsert(group: CrudEntry[]): Outcome {
    const table = group[0]?.table ?? "";
    // The same row can be saved twice in a row: a PUT is the whole row, so the last one wins
    // (and Postgres refuses an upsert that touches one row twice).
    const last = new Map(group.map((e) => [e.id, e]));
    const rows = [...last.values()].map((e) => ({
      ...toRemote(table, e.opData ?? {}, true),
      id: e.id,
    }));
    return this.supabase.from(table).upsert(rows, { onConflict: "id" });
  }

  private one(entry: CrudEntry): Outcome {
    const table = entry.table;
    switch (entry.op) {
      case UpdateType.PUT:
        return this.supabase
          .from(table)
          .upsert(
            { ...toRemote(table, entry.opData ?? {}, true), id: entry.id },
            { onConflict: "id" },
          );
      case UpdateType.PATCH:
        return this.supabase
          .from(table)
          .update(toRemote(table, entry.opData ?? {}))
          .eq("id", entry.id);
      case UpdateType.DELETE:
        return this.supabase.from(table).delete().eq("id", entry.id);
    }
  }

  private async recordPermanent(
    database: AbstractPowerSyncDatabase,
    entry: CrudEntry,
    failure: Failure,
  ): Promise<void> {
    await database.execute(
      "INSERT INTO sync_errors (id, table_name, row_id, op, code, message, created_at) VALUES (uuid(), ?, ?, ?, ?, ?, ?)",
      [
        entry.table,
        entry.id,
        entry.op,
        failure.code ?? null,
        failure.message,
        new Date().toISOString(),
      ],
    );
  }
}
