import { syncedForRead, syncUserId, watchTables, writableDb } from "@margin/sync/client";
import type {
  Book,
  BookPatch,
  DocumentsRepo,
  ReadingState,
  ReadingStateRepo,
  ReadStatus,
} from "./documents-repo";

type Row = {
  id: string;
  title: string;
  author: string | null;
  sha256: string;
  byte_size: number | null;
  page_count: number | null;
  storage_path: string | null;
  cover_path: string | null;
  has_text_layer: number | null;
  read_status: ReadStatus;
  last_opened_at: string | null;
  created_at: string;
  annotations_imported_at: string | null;
  percent?: number | null;
};

const COLUMNS =
  "d.id, d.title, d.author, d.sha256, d.byte_size, d.page_count, d.storage_path, d.cover_path, d.has_text_layer, d.read_status, d.last_opened_at, d.created_at, d.annotations_imported_at";

const toBook = (row: Row): Book => ({
  id: row.id,
  title: row.title,
  author: row.author,
  sha256: row.sha256,
  byteSize: row.byte_size,
  pageCount: row.page_count,
  storagePath: row.storage_path,
  coverPath: row.cover_path,
  hasTextLayer: row.has_text_layer === null ? null : row.has_text_layer === 1,
  readStatus: row.read_status,
  lastOpenedAt: row.last_opened_at,
  createdAt: row.created_at,
  annotationsImportedAt: row.annotations_imported_at,
  percent: row.percent ?? 0,
});

const SELECT = `SELECT ${COLUMNS}, COALESCE(rs.percent, 0) AS percent
  FROM documents d
  LEFT JOIN (SELECT document_id, MAX(percent) AS percent FROM reading_state WHERE deleted_at IS NULL GROUP BY document_id) rs ON rs.document_id = d.id
  WHERE d.deleted_at IS NULL`;

/** `DocumentsRepo` over the local PowerSync database: reads are local, writes sync in the background. */
export function createPowerSyncDocumentsRepo(): DocumentsRepo {
  return {
    async list() {
      const db = await syncedForRead();
      return (await db.getAll<Row>(`${SELECT} ORDER BY d.created_at DESC`)).map(toBook);
    },

    async get(id) {
      const db = await syncedForRead();
      const row = await db.getOptional<Row>(`${SELECT} AND d.id = ?`, [id]);
      return row ? toBook(row) : null;
    },

    async findBySha(sha256) {
      const db = await syncedForRead();
      const row = await db.getOptional<Row>(`${SELECT} AND d.sha256 = ?`, [sha256]);
      return row ? toBook(row) : null;
    },

    async create(book) {
      const db = await writableDb();
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO documents (id, user_id, title, sha256, byte_size, storage_path, read_status, ai_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'uploading', 'none', ?, ?)`,
        [book.id, syncUserId(), book.title, book.sha256, book.byteSize, book.storagePath, now, now],
      );
    },

    async update(id, patch: BookPatch) {
      const sets: string[] = [];
      const args: (string | number | null)[] = [];
      const set = (column: string, value: string | number | null) => {
        sets.push(`${column} = ?`);
        args.push(value);
      };
      if (patch.title !== undefined) set("title", patch.title);
      if (patch.author !== undefined) set("author", patch.author);
      if (patch.lastOpenedAt !== undefined) set("last_opened_at", patch.lastOpenedAt);
      if (patch.coverPath !== undefined) set("cover_path", patch.coverPath);
      if (patch.pageCount !== undefined) set("page_count", patch.pageCount);
      if (patch.hasTextLayer !== undefined) set("has_text_layer", patch.hasTextLayer ? 1 : 0);
      if (patch.outline !== undefined) set("outline", JSON.stringify(patch.outline));
      if (sets.length === 0) return;
      set("updated_at", new Date().toISOString());
      const db = await writableDb();
      await db.execute(`UPDATE documents SET ${sets.join(", ")} WHERE id = ?`, [...args, id]);
    },

    async claimImport(id) {
      const db = await writableDb();
      const now = new Date().toISOString();
      // (UPDATE on a PowerSync view reports no row count, so check first; the write lock makes it atomic here.)
      return db.writeTransaction(async (tx) => {
        const row = await tx.getOptional<{ done: string | null }>(
          "SELECT annotations_imported_at AS done FROM documents WHERE id = ?",
          [id],
        );
        if (!row || row.done !== null) return false;
        await tx.execute(
          "UPDATE documents SET annotations_imported_at = ?, updated_at = ? WHERE id = ?",
          [now, now, id],
        );
        return true;
      });
    },

    async releaseImport(id) {
      const db = await writableDb();
      await db.execute(
        "UPDATE documents SET annotations_imported_at = NULL, updated_at = ? WHERE id = ?",
        [new Date().toISOString(), id],
      );
    },

    async softDelete(id) {
      const db = await writableDb();
      const now = new Date().toISOString();
      await db.execute("UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ?", [
        now,
        now,
        id,
      ]);
    },

    async restore(id) {
      const db = await writableDb();
      await db.execute("UPDATE documents SET deleted_at = NULL, updated_at = ? WHERE id = ?", [
        new Date().toISOString(),
        id,
      ]);
    },

    subscribe: (onChange) => watchTables(["documents", "reading_state"], onChange),
  };
}

type StateRow = {
  page: number;
  offset_pt: number | null;
  zoom: number | null;
  percent: number | null;
  seconds_read: number;
};

/**
 * Reading position. New rows use the document id as their row id: two devices that start reading
 * the same book then upsert one row instead of colliding on `unique (user_id, document_id)`.
 */
export function createPowerSyncReadingStateRepo(): ReadingStateRepo {
  return {
    async get(documentId) {
      const db = await syncedForRead();
      const row = await db.getOptional<StateRow>(
        "SELECT page, offset_pt, zoom, percent, seconds_read FROM reading_state WHERE document_id = ? AND deleted_at IS NULL",
        [documentId],
      );
      if (!row) return null;
      return {
        page: row.page,
        offsetPt: row.offset_pt,
        zoom: row.zoom,
        percent: row.percent,
        secondsRead: row.seconds_read,
      } satisfies ReadingState;
    },

    async save(documentId, state) {
      const db = await writableDb();
      const now = new Date().toISOString();
      const values = [state.page, state.offsetPt, state.zoom, state.percent, state.secondsRead];
      await db.writeTransaction(async (tx) => {
        const exists = await tx.getOptional<{ id: string }>(
          "SELECT id FROM reading_state WHERE document_id = ?",
          [documentId],
        );
        if (exists) {
          await tx.execute(
            "UPDATE reading_state SET page = ?, offset_pt = ?, zoom = ?, percent = ?, seconds_read = ?, deleted_at = NULL, updated_at = ? WHERE document_id = ?",
            [...values, now, documentId],
          );
          return;
        }
        await tx.execute(
          "INSERT INTO reading_state (id, user_id, document_id, page, offset_pt, zoom, percent, seconds_read, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [documentId, syncUserId(), documentId, ...values, now, now],
        );
      });
    },
  };
}
