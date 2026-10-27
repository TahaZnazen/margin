import { publicEnv } from "@/env";
import type { StorageProvider } from "@/lib/storage/storage-provider";
import { createSupabaseStorage } from "@/lib/storage/supabase-storage";
import { createClient } from "@/lib/supabase/client";
import type { AnnotationsRepo } from "../annotations/annotations-repo";
import { createSupabaseAnnotationsRepo } from "../annotations/supabase-annotations-repo";
import type { DocumentsRepo, ReadingStateRepo } from "./documents-repo";
import {
  createSupabaseDocumentsRepo,
  createSupabaseReadingStateRepo,
} from "./supabase-documents-repo";

export interface Services {
  documents: DocumentsRepo;
  readingState: ReadingStateRepo;
  annotations: AnnotationsRepo;
  storage: StorageProvider;
}

let cached: Services | undefined;

/** Browser-side wiring. P06 replaces the repos with PowerSync-backed ones here and nowhere else. */
export function services(): Services {
  if (!cached) {
    const supabase = createClient();
    cached = {
      documents: createSupabaseDocumentsRepo(supabase),
      readingState: createSupabaseReadingStateRepo(supabase),
      annotations: createSupabaseAnnotationsRepo(supabase),
      storage: createSupabaseStorage(supabase, publicEnv().NEXT_PUBLIC_SUPABASE_URL),
    };
  }
  return cached;
}

export async function currentUserId(): Promise<string> {
  const { data } = await createClient().auth.getSession();
  if (!data.session) throw new Error("Not signed in.");
  return data.session.user.id;
}
