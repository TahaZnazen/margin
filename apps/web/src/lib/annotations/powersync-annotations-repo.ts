import { AnnotationTarget } from "@margin/annotation-model";
import { syncedForRead, syncUserId, watchTables, writableDb } from "@margin/sync/client";
import type { Annotation, AnnotationsRepo } from "./annotations-repo";

type Row = {
  id: string;
  document_id: string;
  kind: Annotation["kind"];
  color: Annotation["color"];
  target: string;
  page_start: number;
  quote_text: string | null;
  comment: string | null;
  anchor_status: Annotation["anchorStatus"];
  created_at: string;
  updated_at: string;
};

function toAnnotation(row: Row): Annotation | null {
  let json: unknown;
  try {
    json = JSON.parse(row.target);
  } catch {
    json = null;
  }
  const target = AnnotationTarget.safeParse(json);
  if (!target.success) {
    console.warn("Skipping an annotation with an unreadable target", row.id);
    return null;
  }
  return {
    id: row.id,
    documentId: row.document_id,
    kind: row.kind,
    color: row.color,
    target: target.data,
    pageStart: row.page_start,
    quoteText: row.quote_text,
    comment: row.comment,
    anchorStatus: row.anchor_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** `AnnotationsRepo` over the local PowerSync database. */
export function createPowerSyncAnnotationsRepo(): AnnotationsRepo {
  return {
    async list(documentId) {
      const db = await syncedForRead();
      const rows = await db.getAll<Row>(
        `SELECT id, document_id, kind, color, target, page_start, quote_text, comment, anchor_status, created_at, updated_at
         FROM annotations WHERE document_id = ? AND deleted_at IS NULL AND kind <> 'ink'
         ORDER BY page_start ASC`,
        [documentId],
      );
      return rows.flatMap((row) => toAnnotation(row) ?? []);
    },

    async save(a) {
      const target = AnnotationTarget.parse(a.target);
      const db = await writableDb();
      await db.execute(
        `INSERT OR REPLACE INTO annotations
           (id, user_id, document_id, kind, color, target, page_start, quote_text, comment, tags, anchor_status, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, NULL)`,
        [
          a.id,
          syncUserId(),
          a.documentId,
          a.kind,
          a.color,
          JSON.stringify(target),
          a.pageStart,
          a.quoteText,
          a.comment,
          a.anchorStatus,
          a.createdAt,
          new Date().toISOString(),
        ],
      );
    },

    async remove(id) {
      const db = await writableDb();
      const now = new Date().toISOString();
      await db.execute("UPDATE annotations SET deleted_at = ?, updated_at = ? WHERE id = ?", [
        now,
        now,
        id,
      ]);
    },

    subscribe: (_documentId, onChange) => watchTables(["annotations"], onChange),
  };
}
