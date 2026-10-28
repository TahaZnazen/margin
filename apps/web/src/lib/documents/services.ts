import { getSyncDatabase, syncUserId } from "@margin/sync/client";
import { publicEnv } from "@/env";
import type { StorageProvider } from "@/lib/storage/storage-provider";
import { createSupabaseStorage } from "@/lib/storage/supabase-storage";
import { createClient } from "@/lib/supabase/client";
import type { AnnotationsRepo } from "../annotations/annotations-repo";
import { createPowerSyncAnnotationsRepo } from "../annotations/powersync-annotations-repo";
import type { NotesRepo } from "../notes/notes-repo";
import { createPowerSyncNotesRepo } from "../notes/powersync-notes-repo";
import { createPowerSyncSettingsRepo } from "../settings/powersync-settings-repo";
import type { SettingsRepo } from "../settings/settings-repo";
import type { DocumentsRepo, ReadingStateRepo } from "./documents-repo";
import {
  createPowerSyncDocumentsRepo,
  createPowerSyncReadingStateRepo,
} from "./powersync-documents-repo";

export interface Services {
  documents: DocumentsRepo;
  readingState: ReadingStateRepo;
  annotations: AnnotationsRepo;
  notes: NotesRepo;
  settings: SettingsRepo;
  storage: StorageProvider;
}

let cached: Services | undefined;

/**
 * Browser-side wiring. Data repos read and write the local PowerSync database (synced in the
 * background by `SyncProvider`); only file storage still talks to Supabase directly.
 */
export function services(): Services {
  if (!cached) {
    cached = {
      documents: createPowerSyncDocumentsRepo(),
      readingState: createPowerSyncReadingStateRepo(),
      annotations: createPowerSyncAnnotationsRepo(),
      notes: createPowerSyncNotesRepo(),
      settings: createPowerSyncSettingsRepo(),
      storage: createSupabaseStorage(createClient(), publicEnv().NEXT_PUBLIC_SUPABASE_URL),
    };
  }
  return cached;
}

declare global {
  interface Window {
    /** Test hook: E2E specs drive the same repos the UI uses. Same-origin code only. */
    __margin?: { services: typeof services; db: typeof getSyncDatabase };
  }
}

if (typeof window !== "undefined") window.__margin = { services, db: getSyncDatabase };

/** The signed-in user's id: set by `SyncProvider`, so it works offline. */
export async function currentUserId(): Promise<string> {
  return syncUserId();
}
