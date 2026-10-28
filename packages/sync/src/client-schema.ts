import { column, Schema, Table } from "@powersync/common";
import { AppSchema } from "./schema";

/** Local-only: never uploaded, never synced. Uploads that the server rejected for good land here. */
const sync_errors = new Table(
  {
    table_name: column.text,
    row_id: column.text,
    op: column.text,
    code: column.text,
    message: column.text,
    created_at: column.text,
  },
  { localOnly: true },
);

/** The synced contract schema plus the local-only `sync_errors` table. */
export const ClientSchema = new Schema([
  ...AppSchema.tables,
  sync_errors.copyWithName("sync_errors"),
]);

export interface SyncErrorRow {
  id: string;
  table_name: string;
  row_id: string;
  op: string;
  code: string | null;
  message: string | null;
  created_at: string;
}
