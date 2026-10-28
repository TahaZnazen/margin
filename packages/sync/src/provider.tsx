"use client";

import { PowerSyncContext, useQuery, useStatus } from "@powersync/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import type { SyncErrorRow } from "./client-schema";
import { SupabaseConnector } from "./connector";
import {
  getSyncDatabase,
  markSyncReady,
  refreshUnsynced,
  resetSyncReady,
  setSyncUserId,
  syncReady,
  unsyncedStore,
  waitForUploads,
  watchTables,
} from "./database";

const SYNCED_TABLES = [
  "documents",
  "reading_state",
  "annotations",
  "notes",
  "collections",
  "collection_documents",
  "user_settings",
];

const OWNER_KEY = "margin.sync.user";

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function writeOwner(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    // Storage blocked: the sign-out path still clears the database.
  }
}

/**
 * Opens the local database after sign-in and connects it to PowerSync. If the database holds
 * another user's data (a sign-out that never finished), it's cleared first: one user's rows never
 * show up for another.
 */
export function SyncProvider({
  supabase,
  userId,
  endpoint,
  children,
}: {
  supabase: SupabaseClient;
  userId: string;
  endpoint: string;
  children: ReactNode;
}) {
  const [db] = useState(() => (typeof window === "undefined" ? null : getSyncDatabase()));

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    setSyncUserId(userId);
    void (async () => {
      const owner = readOwner();
      if (owner && owner !== userId) await db.disconnectAndClear();
      writeOwner(userId);
      if (cancelled) return;
      markSyncReady();
      await db.connect(new SupabaseConnector(supabase, endpoint), { retryDelayMs: 1000 });
    })().catch((error) => console.error("Could not start sync", error));
    return () => {
      cancelled = true;
    };
  }, [db, supabase, userId, endpoint]);

  if (!db) return <>{children}</>;
  return <PowerSyncContext.Provider value={db}>{children}</PowerSyncContext.Provider>;
}

/**
 * Sign-out: give pending writes a moment to upload, then drop the local copy of the user's data.
 * Call before `supabase.auth.signOut()`.
 */
export async function clearLocalData(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || navigator.onLine) await waitForUploads(3000);
  } catch {
    // Nothing more to wait for.
  }
  const db = await syncReady();
  await db.disconnectAndClear();
  writeOwner(null);
  setSyncUserId(null);
  resetSyncReady();
}

export type SyncState = "synced" | "syncing" | "offline" | "error";

export interface SyncSummary {
  state: SyncState;
  errors: SyncErrorRow[];
}

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** Live sync status. Needs a mounted `SyncProvider`. */
export function useSyncSummary(): SyncSummary {
  const status = useStatus();
  const { data } = useQuery<SyncErrorRow>(
    "SELECT * FROM sync_errors ORDER BY created_at DESC LIMIT 50",
  );
  const online = useOnline();
  let state: SyncState;
  if (data.length > 0) state = "error";
  else if (!online) state = "offline";
  else if (status.connected) {
    state =
      status.dataFlowStatus.uploading || status.dataFlowStatus.downloading ? "syncing" : "synced";
  } else if (status.connecting) state = "syncing";
  else state = "offline";
  return { state, errors: data };
}

/** How many local writes have not reached the server yet. Needs a mounted `SyncProvider`. */
export function useUnsyncedWrites(): number {
  useEffect(() => {
    const poll = () => void refreshUnsynced().catch(() => undefined);
    poll();
    const timer = setInterval(poll, 250);
    const unwatch = watchTables(SYNCED_TABLES, poll);
    return () => {
      clearInterval(timer);
      unwatch();
    };
  }, []);
  return useSyncExternalStore(unsyncedStore.subscribe, unsyncedStore.get, () => 0);
}

/** Removes an entry from the error list (the user dismissed it). */
export async function dismissSyncError(id: string): Promise<void> {
  const db = await syncReady();
  await db.execute("DELETE FROM sync_errors WHERE id = ?", [id]);
}
