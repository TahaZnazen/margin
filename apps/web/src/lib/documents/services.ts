import { getSyncDatabase, syncUserId } from "@margin/sync/client";
import { publicEnv } from "@/env";
import type { StorageProvider } from "@/lib/storage/storage-provider";
import { createSupabaseStorage } from "@/lib/storage/supabase-storage";
import { createClient } from "@/lib/supabase/client";
import type { AllHighlightsRepo, AnnotationsRepo } from "../annotations/annotations-repo";
import {
  createPowerSyncAllHighlightsRepo,
  createPowerSyncAnnotationsRepo,
} from "../annotations/powersync-annotations-repo";
import type { ChapterProgressRepo } from "../chapters/chapter-progress-repo";
import { createPowerSyncChapterProgressRepo } from "../chapters/powersync-chapter-progress-repo";
import type { NotesRepo } from "../notes/notes-repo";
import { createPowerSyncNotesRepo } from "../notes/powersync-notes-repo";
import { createPowerSyncSettingsRepo } from "../settings/powersync-settings-repo";
import type { SettingsRepo } from "../settings/settings-repo";
import { createPowerSyncShelvesRepo } from "../shelves/powersync-shelves-repo";
import type { ShelvesRepo } from "../shelves/shelves-repo";
import type { DocumentsRepo, ReadingStateRepo } from "./documents-repo";
import {
  createPowerSyncDocumentsRepo,
  createPowerSyncReadingStateRepo,
} from "./powersync-documents-repo";

export interface Services {
  documents: DocumentsRepo;
  readingState: ReadingStateRepo;
  annotations: AnnotationsRepo;
  allHighlights: AllHighlightsRepo;
  notes: NotesRepo;
  settings: SettingsRepo;
  shelves: ShelvesRepo;
  chapterProgress: ChapterProgressRepo;
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
      allHighlights: createPowerSyncAllHighlightsRepo(),
      notes: createPowerSyncNotesRepo(),
      settings: createPowerSyncSettingsRepo(),
      shelves: createPowerSyncShelvesRepo(),
      chapterProgress: createPowerSyncChapterProgressRepo(),
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
