import { column, Schema, Table } from "@powersync/common";

/**
 * PowerSync client schema (Contract): the local SQLite views of the Postgres tables in
 * @margin/db. PowerSync adds `id` (text) itself. Postgres types arrive as SQLite types:
 * uuid, text, timestamptz and jsonb → text (timestamps as ISO 8601, JSON as a string);
 * integer, bigint and boolean → integer (booleans as 0/1); real → real.
 *
 * schema.test.ts fails if a column here doesn't match the Drizzle schema.
 */

const ownedColumns = {
  user_id: column.text,
};

const timestampColumns = {
  created_at: column.text,
  updated_at: column.text,
  deleted_at: column.text,
};

const documents = new Table(
  {
    ...ownedColumns,
    title: column.text,
    author: column.text,
    sha256: column.text,
    byte_size: column.integer,
    page_count: column.integer,
    storage_path: column.text,
    cover_path: column.text,
    has_text_layer: column.integer,
    language: column.text,
    outline: column.text,
    read_status: column.text,
    ai_status: column.text,
    annotations_imported_at: column.text,
    last_opened_at: column.text,
    reading_status: column.text,
    ...timestampColumns,
  },
  { indexes: { sha256: ["sha256"], last_opened: ["-last_opened_at"] } },
);

const reading_state = new Table(
  {
    ...ownedColumns,
    document_id: column.text,
    page: column.integer,
    offset_pt: column.real,
    zoom: column.real,
    percent: column.real,
    seconds_read: column.integer,
    ...timestampColumns,
  },
  { indexes: { document: ["document_id"] } },
);

const annotations = new Table(
  {
    ...ownedColumns,
    document_id: column.text,
    kind: column.text,
    color: column.text,
    target: column.text,
    page_start: column.integer,
    quote_text: column.text,
    comment: column.text,
    snapshot_path: column.text,
    tags: column.text,
    anchor_status: column.text,
    ...timestampColumns,
  },
  { indexes: { document_page: ["document_id", "page_start"] } },
);

const notes = new Table(
  {
    ...ownedColumns,
    document_id: column.text,
    title: column.text,
    doc_json: column.text,
    plain_text: column.text,
    ...timestampColumns,
  },
  { indexes: { document: ["document_id"] } },
);

const collections = new Table({
  ...ownedColumns,
  name: column.text,
  sort_order: column.integer,
  ...timestampColumns,
});

const collection_documents = new Table(
  {
    ...ownedColumns,
    collection_id: column.text,
    document_id: column.text,
    ...timestampColumns,
  },
  { indexes: { collection: ["collection_id"], document: ["document_id"] } },
);

const user_settings = new Table({
  ...ownedColumns,
  theme: column.text,
  highlight_labels: column.text,
  reader_prefs: column.text,
  ...timestampColumns,
});

const chapter_progress = new Table(
  {
    ...ownedColumns,
    document_id: column.text,
    chapter_key: column.text,
    title: column.text,
    page_start: column.integer,
    done_at: column.text,
    source: column.text,
    ...timestampColumns,
  },
  { indexes: { document: ["document_id"] } },
);

export const AppSchema = new Schema({
  documents,
  reading_state,
  annotations,
  notes,
  collections,
  collection_documents,
  user_settings,
  chapter_progress,
});

export type LocalDatabase = (typeof AppSchema)["types"];
export type LocalDocument = LocalDatabase["documents"];
export type LocalReadingState = LocalDatabase["reading_state"];
export type LocalAnnotation = LocalDatabase["annotations"];
export type LocalNote = LocalDatabase["notes"];
export type LocalCollection = LocalDatabase["collections"];
export type LocalCollectionDocument = LocalDatabase["collection_documents"];
export type LocalUserSettings = LocalDatabase["user_settings"];
export type LocalChapterProgress = LocalDatabase["chapter_progress"];
