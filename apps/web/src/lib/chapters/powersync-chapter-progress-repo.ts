import { syncedForRead, syncUserId, watchTables, writableDb } from "@margin/sync/client";
import { uuidv5 } from "../uuid";
import type { ChapterProgressRepo } from "./chapter-progress-repo";
import { type ChapterSource, countedKeys, summarize } from "./progress";

/** Fixed namespace for the ids of chapter marks (see `chapterRowId`). Never change it. */
const CHAPTER_NAMESPACE = "b3c1d6a4-8e27-4f59-a0d2-7c9e5f1a6b38";

/**
 * A mark's row id is a UUIDv5 of (book, chapter key), so two devices that tick the same chapter
 * write the same row instead of racing on `unique (user_id, document_id, chapter_key)`.
 */
export const chapterRowId = (documentId: string, chapterKey: string) =>
  uuidv5(`${documentId}:${chapterKey}`, CHAPTER_NAMESPACE);

export function createPowerSyncChapterProgressRepo(): ChapterProgressRepo {
  return {
    async doneForDocument(documentId) {
      const db = await syncedForRead();
      const rows = await db.getAll<{ chapter_key: string; source: string }>(
        "SELECT chapter_key, source FROM chapter_progress WHERE document_id = ? AND deleted_at IS NULL AND done_at IS NOT NULL",
        [documentId],
      );
      return rows.map((r) => ({
        key: r.chapter_key,
        source: (r.source === "auto" ? "auto" : "manual") as ChapterSource,
      }));
    },

    async apply(documentId, changes, source) {
      if (changes.length === 0) return;
      const db = await writableDb();
      const userId = syncUserId();
      const now = new Date().toISOString();
      const ids = await Promise.all(changes.map((c) => chapterRowId(documentId, c.key)));
      await db.writeTransaction(async (tx) => {
        for (const [i, change] of changes.entries()) {
          const fixedId = ids[i] as string;
          const existing = await tx.getOptional<{ id: string }>(
            "SELECT id FROM chapter_progress WHERE document_id = ? AND chapter_key = ?",
            [documentId, change.key],
          );
          if (existing) {
            await tx.execute(
              "UPDATE chapter_progress SET done_at = ?, source = ?, title = ?, page_start = ?, deleted_at = NULL, updated_at = ? WHERE id = ?",
              [
                change.done ? now : null,
                change.done ? source : "manual",
                change.title,
                change.page,
                now,
                existing.id,
              ],
            );
          } else if (change.done) {
            await tx.execute(
              "INSERT INTO chapter_progress (id, user_id, document_id, chapter_key, title, page_start, done_at, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                fixedId,
                userId,
                documentId,
                change.key,
                change.title,
                change.page,
                now,
                source,
                now,
                now,
              ],
            );
          }
        }
      });
    },

    async summaries() {
      const db = await syncedForRead();
      const [docs, marks] = await Promise.all([
        db.getAll<{ id: string; outline: string | null }>(
          "SELECT id, outline FROM documents WHERE deleted_at IS NULL",
        ),
        db.getAll<{ document_id: string; chapter_key: string }>(
          "SELECT document_id, chapter_key FROM chapter_progress WHERE deleted_at IS NULL AND done_at IS NOT NULL",
        ),
      ]);
      const doneByDoc = new Map<string, Set<string>>();
      for (const m of marks) {
        const set = doneByDoc.get(m.document_id) ?? new Set<string>();
        set.add(m.chapter_key);
        doneByDoc.set(m.document_id, set);
      }
      const out = new Map<string, ReturnType<typeof summarize>>();
      for (const doc of docs) {
        const done = doneByDoc.get(doc.id) ?? new Set<string>();
        const keys = countedKeys(doc.outline);
        if (keys.length > 0 || done.size > 0) out.set(doc.id, summarize(keys, done));
      }
      return out;
    },

    subscribe: (onChange) => watchTables(["chapter_progress", "documents"], onChange),
  };
}
