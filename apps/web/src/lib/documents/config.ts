/** Supabase Free caps objects at 50 MB (see migration 0002). Change here when the plan changes. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "50 MB";
export const SIGNED_URL_TTL_SECONDS = 600;
/** How long a deleted book can be restored before its files are removed. */
export const UNDO_WINDOW_MS = 8000;

export const sourcePath = (userId: string, documentId: string) =>
  `${userId}/${documentId}/source.pdf`;
export const coverPath = (userId: string, documentId: string) =>
  `${userId}/${documentId}/cover.webp`;
