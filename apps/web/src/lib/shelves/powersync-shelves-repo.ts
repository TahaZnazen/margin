import { syncedForRead, syncUserId, watchTables, writableDb } from "@margin/sync/client";
import { uuidv5, uuidv7 } from "../uuid";
import { cleanShelfName } from "./logic";
import type { Shelf, ShelfLink, ShelvesRepo } from "./shelves-repo";

/** Fixed namespace for the ids of shelf links (see `linkId`). Never change it. */
const LINK_NAMESPACE = "6f0c7a52-3d41-4c6e-9b1e-5a3f8d2e7c10";

/**
 * A link's row id is a UUIDv5 of (shelf, book), the way `reading_state` uses the document id.
 * `collection_documents` has `unique (collection_id, document_id)`; with a random id per insert,
 * "remove, then add again" (or two devices adding the same book) would send a second row for the
 * same pair and fail on sync. With a fixed id it is always an upsert of one row. Re-adding also
 * un-deletes the existing row, whatever its id (rows from before this rule keep theirs).
 */
export const linkId = (shelfId: string, documentId: string) =>
  uuidv5(`${shelfId}:${documentId}`, LINK_NAMESPACE);

type ShelfRow = { id: string; name: string; sort_order: number | null; created_at: string };

export function createPowerSyncShelvesRepo(): ShelvesRepo {
  return {
    async list() {
      const db = await syncedForRead();
      const rows = await db.getAll<ShelfRow>(
        "SELECT id, name, sort_order, created_at FROM collections WHERE deleted_at IS NULL ORDER BY COALESCE(sort_order, 0), created_at",
      );
      return rows.map(
        (r): Shelf => ({
          id: r.id,
          name: r.name,
          sortOrder: r.sort_order ?? 0,
          createdAt: r.created_at,
        }),
      );
    },

    async links() {
      const db = await syncedForRead();
      const rows = await db.getAll<{ collection_id: string; document_id: string }>(
        `SELECT cd.collection_id, cd.document_id FROM collection_documents cd
         JOIN collections c ON c.id = cd.collection_id AND c.deleted_at IS NULL
         JOIN documents d ON d.id = cd.document_id AND d.deleted_at IS NULL
         WHERE cd.deleted_at IS NULL`,
      );
      return rows.map((r): ShelfLink => ({ shelfId: r.collection_id, documentId: r.document_id }));
    },

    async create(rawName) {
      const name = cleanShelfName(rawName);
      if (!name) throw new Error("A shelf needs a name.");
      const db = await writableDb();
      const now = new Date().toISOString();
      const id = uuidv7();
      const sortOrder = await db.writeTransaction(async (tx) => {
        const top = await tx.getOptional<{ top: number | null }>(
          "SELECT MAX(sort_order) AS top FROM collections WHERE deleted_at IS NULL",
        );
        const next = (top?.top ?? -1) + 1;
        await tx.execute(
          "INSERT INTO collections (id, user_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          [id, syncUserId(), name, next, now, now],
        );
        return next;
      });
      return { id, name, sortOrder, createdAt: now };
    },

    async rename(id, rawName) {
      const name = cleanShelfName(rawName);
      if (!name) throw new Error("A shelf needs a name.");
      const db = await writableDb();
      await db.execute("UPDATE collections SET name = ?, updated_at = ? WHERE id = ?", [
        name,
        new Date().toISOString(),
        id,
      ]);
    },

    async softDelete(id) {
      const db = await writableDb();
      const now = new Date().toISOString();
      return db.writeTransaction(async (tx) => {
        const live = await tx.getAll<{ id: string }>(
          "SELECT id FROM collection_documents WHERE collection_id = ? AND deleted_at IS NULL",
          [id],
        );
        for (const link of live) {
          await tx.execute(
            "UPDATE collection_documents SET deleted_at = ?, updated_at = ? WHERE id = ?",
            [now, now, link.id],
          );
        }
        await tx.execute("UPDATE collections SET deleted_at = ?, updated_at = ? WHERE id = ?", [
          now,
          now,
          id,
        ]);
        return live.map((l) => l.id);
      });
    },

    async restore(id, linkIds) {
      const db = await writableDb();
      const now = new Date().toISOString();
      await db.writeTransaction(async (tx) => {
        await tx.execute("UPDATE collections SET deleted_at = NULL, updated_at = ? WHERE id = ?", [
          now,
          id,
        ]);
        for (const linkRowId of linkIds) {
          await tx.execute(
            "UPDATE collection_documents SET deleted_at = NULL, updated_at = ? WHERE id = ?",
            [now, linkRowId],
          );
        }
      });
    },

    async setMember(shelfId, documentId, member) {
      const db = await writableDb();
      const now = new Date().toISOString();
      const fixedId = await linkId(shelfId, documentId);
      await db.writeTransaction(async (tx) => {
        const existing = await tx.getOptional<{ id: string; deleted_at: string | null }>(
          "SELECT id, deleted_at FROM collection_documents WHERE collection_id = ? AND document_id = ?",
          [shelfId, documentId],
        );
        if (!member) {
          if (existing && existing.deleted_at === null) {
            await tx.execute(
              "UPDATE collection_documents SET deleted_at = ?, updated_at = ? WHERE id = ?",
              [now, now, existing.id],
            );
          }
          return;
        }
        if (!existing) {
          await tx.execute(
            "INSERT INTO collection_documents (id, user_id, collection_id, document_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            [fixedId, syncUserId(), shelfId, documentId, now, now],
          );
        } else if (existing.deleted_at !== null) {
          await tx.execute(
            "UPDATE collection_documents SET deleted_at = NULL, updated_at = ? WHERE id = ?",
            [now, existing.id],
          );
        }
      });
    },

    subscribe: (onChange) =>
      watchTables(["collections", "collection_documents", "documents"], onChange),
  };
}
