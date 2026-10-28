import { syncedForRead, syncUserId, writableDb } from "@margin/sync/client";
import type { Note, NotesRepo } from "./notes-repo";

type Row = {
  id: string;
  document_id: string | null;
  title: string | null;
  doc_json: string | null;
  plain_text: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS = "id, document_id, title, doc_json, plain_text, created_at, updated_at";

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const toNote = (r: Row): Note => ({
  id: r.id,
  documentId: r.document_id,
  title: r.title,
  docJson: parseJson(r.doc_json),
  plainText: r.plain_text ?? "",
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** `NotesRepo` over the local PowerSync database. */
export function createPowerSyncNotesRepo(): NotesRepo {
  return {
    async getForDocument(documentId) {
      const db = await syncedForRead();
      const row = await db.getOptional<Row>(
        `SELECT ${COLUMNS} FROM notes WHERE document_id = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
        [documentId],
      );
      return row ? toNote(row) : null;
    },

    async list() {
      const db = await syncedForRead();
      const rows = await db.getAll<Row>(
        `SELECT ${COLUMNS} FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC`,
      );
      return rows.map(toNote);
    },

    async get(id) {
      const db = await syncedForRead();
      const row = await db.getOptional<Row>(
        `SELECT ${COLUMNS} FROM notes WHERE id = ? AND deleted_at IS NULL`,
        [id],
      );
      return row ? toNote(row) : null;
    },

    async save(n) {
      const db = await writableDb();
      await db.execute(
        `INSERT OR REPLACE INTO notes (id, user_id, document_id, title, doc_json, plain_text, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          n.id,
          syncUserId(),
          n.documentId,
          n.title,
          n.docJson === null || n.docJson === undefined ? null : JSON.stringify(n.docJson),
          n.plainText,
          n.createdAt,
          new Date().toISOString(),
        ],
      );
    },

    async remove(id) {
      const db = await writableDb();
      const now = new Date().toISOString();
      await db.execute("UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ?", [
        now,
        now,
        id,
      ]);
    },
  };
}
