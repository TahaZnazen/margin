/**
 * Database schema (Contract: docs/ARCHITECTURE.md §3). Changes need an ADR in docs/adr/.
 *
 * Every table is owned by one user and follows the same shape: a client-generated UUIDv7 `id`,
 * `user_id` → auth.users (on delete cascade), `created_at`, `updated_at` (set by a trigger, see
 * migrations/0001) and `deleted_at` (soft delete: sync needs tombstones). RLS lets a signed-in user
 * select, insert, update and delete only rows whose `user_id` is their own.
 *
 * Child rows reference their parent through a composite foreign key `(user_id, parent_id)` →
 * `parent(user_id, id)`, so a row can only point at a parent owned by the same user.
 */
import {
  ANCHOR_STATUSES,
  ANNOTATION_KINDS,
  type AnnotationTarget,
  HIGHLIGHT_COLORS,
  type HighlightColor,
} from "@margin/annotation-model";
import { type SQL, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid, authUsers } from "drizzle-orm/supabase";

export const READ_STATUSES = ["uploading", "readable", "failed"] as const;
export const AI_STATUSES = ["none", "pending", "processing", "ready", "failed"] as const;
export const THEMES = ["light", "sepia", "dark", "system"] as const;

/** The tables of this contract, in dependency order. All of them sync to the client. */
export const TABLE_NAMES = [
  "documents",
  "reading_state",
  "annotations",
  "notes",
  "collections",
  "collection_documents",
  "user_settings",
] as const;
export type TableName = (typeof TABLE_NAMES)[number];

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** id and user_id: the first two columns of every table. */
const owned = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
});

/** created_at, updated_at, deleted_at: the last three columns of every table. */
const timestamps = () => ({
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  deletedAt: timestamptz("deleted_at"),
});

/** `column in ('a', 'b', …)` for a CHECK constraint. Values are compile-time constants. */
function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const list = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
  return sql`${column} in (${sql.raw(list)})`;
}

/** RLS: a signed-in user selects, inserts, updates and deletes only their own rows. */
function ownRowsOnly(table: TableName, userId: AnyPgColumn) {
  const own = sql`${userId} = ${authUid}`;
  return [
    pgPolicy(`${table}_select_own`, { for: "select", to: authenticatedRole, using: own }),
    pgPolicy(`${table}_insert_own`, { for: "insert", to: authenticatedRole, withCheck: own }),
    pgPolicy(`${table}_update_own`, {
      for: "update",
      to: authenticatedRole,
      using: own,
      withCheck: own,
    }),
    pgPolicy(`${table}_delete_own`, { for: "delete", to: authenticatedRole, using: own }),
  ];
}

export const documents = pgTable(
  "documents",
  {
    ...owned(),
    title: text("title").notNull(),
    author: text("author"),
    /** SHA-256 of the file, 64 lowercase hex digits. Annotation fingerprints are `sha256:<this>`. */
    sha256: text("sha256").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }),
    pageCount: integer("page_count"),
    storagePath: text("storage_path"),
    coverPath: text("cover_path"),
    hasTextLayer: boolean("has_text_layer"),
    language: text("language"),
    outline: jsonb("outline"),
    readStatus: text("read_status", { enum: READ_STATUSES }).notNull().default("uploading"),
    aiStatus: text("ai_status", { enum: AI_STATUSES }).notNull().default("none"),
    annotationsImportedAt: timestamptz("annotations_imported_at"),
    lastOpenedAt: timestamptz("last_opened_at"),
    ...timestamps(),
  },
  (t) => [
    // Target of the children's composite foreign keys; also serves the user_id foreign key.
    unique("documents_user_id_id_key").on(t.userId, t.id),
    uniqueIndex("documents_user_id_sha256_key")
      .on(t.userId, t.sha256)
      .where(sql`${t.deletedAt} is null`),
    check("documents_sha256_check", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check("documents_read_status_check", oneOf(t.readStatus, READ_STATUSES)),
    check("documents_ai_status_check", oneOf(t.aiStatus, AI_STATUSES)),
    ...ownRowsOnly("documents", t.userId),
  ],
);

export const readingState = pgTable(
  "reading_state",
  {
    ...owned(),
    documentId: uuid("document_id").notNull(),
    page: integer("page").notNull().default(0),
    offsetPt: real("offset_pt"),
    zoom: real("zoom"),
    percent: real("percent"),
    secondsRead: integer("seconds_read").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    unique("reading_state_user_id_document_id_key").on(t.userId, t.documentId),
    foreignKey({
      name: "reading_state_document_fk",
      columns: [t.userId, t.documentId],
      foreignColumns: [documents.userId, documents.id],
    }).onDelete("cascade"),
    ...ownRowsOnly("reading_state", t.userId),
  ],
);

export const annotations = pgTable(
  "annotations",
  {
    ...owned(),
    documentId: uuid("document_id").notNull(),
    kind: text("kind", { enum: ANNOTATION_KINDS }).notNull(),
    color: text("color", { enum: HIGHLIGHT_COLORS }),
    target: jsonb("target").$type<AnnotationTarget>().notNull(),
    /** The first segment's page (0-based), denormalized for sorting and filtering. */
    pageStart: integer("page_start").notNull(),
    quoteText: text("quote_text"),
    comment: text("comment"),
    snapshotPath: text("snapshot_path"),
    tags: jsonb("tags").$type<string[]>().default(sql`'[]'::jsonb`),
    anchorStatus: text("anchor_status", { enum: ANCHOR_STATUSES }).notNull().default("anchored"),
    ...timestamps(),
  },
  (t) => [
    index("annotations_user_id_document_id_page_start_idx").on(t.userId, t.documentId, t.pageStart),
    foreignKey({
      name: "annotations_document_fk",
      columns: [t.userId, t.documentId],
      foreignColumns: [documents.userId, documents.id],
    }).onDelete("cascade"),
    check("annotations_kind_check", oneOf(t.kind, ANNOTATION_KINDS)),
    check("annotations_color_check", oneOf(t.color, HIGHLIGHT_COLORS)),
    check("annotations_anchor_status_check", oneOf(t.anchorStatus, ANCHOR_STATUSES)),
    // "Target by kind" (ARCHITECTURE §4, ADR 0001), as far as SQL can express it. The zod
    // AnnotationShape in @margin/annotation-model is the full rule.
    check(
      "annotations_highlight_check",
      sql`${t.kind} <> 'highlight' or (${t.color} is not null and ${t.quoteText} is not null and ${t.quoteText} <> '')`,
    ),
    check("annotations_area_check", sql`${t.kind} <> 'area' or ${t.quoteText} is null`),
    check(
      "annotations_bookmark_check",
      sql`${t.kind} <> 'bookmark' or (${t.color} is null and ${t.quoteText} is null)`,
    ),
    // Segment and rect counts per kind, and page_start = the first segment's page. Ink targets
    // aren't defined yet (Phase 4), so any JSON object passes for them. CASE keeps the array
    // functions away from values that aren't arrays.
    check(
      "annotations_target_check",
      sql`case
        when ${t.kind} = 'ink' then jsonb_typeof(${t.target}) = 'object'
        when coalesce(jsonb_typeof(${t.target} -> 'segments'), '') <> 'array'
          or coalesce(jsonb_typeof(${t.target} #> '{segments,0,rects}'), '') <> 'array'
          then false
        else (${t.target} #>> '{segments,0,page}') = ${t.pageStart}::text
          and case ${t.kind}
            when 'highlight' then ${t.target} ? 'quote'
              and jsonb_array_length(${t.target} #> '{segments,0,rects}') >= 1
            when 'area' then not (${t.target} ? 'quote')
              and jsonb_array_length(${t.target} -> 'segments') = 1
              and jsonb_array_length(${t.target} #> '{segments,0,rects}') = 1
            else not (${t.target} ? 'quote')
              and jsonb_array_length(${t.target} -> 'segments') = 1
              and jsonb_array_length(${t.target} #> '{segments,0,rects}') <= 1
          end
      end`,
    ),
    ...ownRowsOnly("annotations", t.userId),
  ],
);

export const notes = pgTable(
  "notes",
  {
    ...owned(),
    /** null = a standalone note. */
    documentId: uuid("document_id"),
    title: text("title"),
    /** Tiptap JSON. */
    docJson: jsonb("doc_json"),
    plainText: text("plain_text"),
    ...timestamps(),
  },
  (t) => [
    index("notes_user_id_document_id_idx").on(t.userId, t.documentId),
    foreignKey({
      name: "notes_document_fk",
      columns: [t.userId, t.documentId],
      foreignColumns: [documents.userId, documents.id],
    }).onDelete("cascade"),
    ...ownRowsOnly("notes", t.userId),
  ],
);

export const collections = pgTable(
  "collections",
  {
    ...owned(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order"),
    ...timestamps(),
  },
  (t) => [
    unique("collections_user_id_id_key").on(t.userId, t.id),
    ...ownRowsOnly("collections", t.userId),
  ],
);

export const collectionDocuments = pgTable(
  "collection_documents",
  {
    ...owned(),
    collectionId: uuid("collection_id").notNull(),
    documentId: uuid("document_id").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("collection_documents_collection_id_document_id_key").on(t.collectionId, t.documentId),
    index("collection_documents_user_id_collection_id_idx").on(t.userId, t.collectionId),
    index("collection_documents_user_id_document_id_idx").on(t.userId, t.documentId),
    foreignKey({
      name: "collection_documents_collection_fk",
      columns: [t.userId, t.collectionId],
      foreignColumns: [collections.userId, collections.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "collection_documents_document_fk",
      columns: [t.userId, t.documentId],
      foreignColumns: [documents.userId, documents.id],
    }).onDelete("cascade"),
    ...ownRowsOnly("collection_documents", t.userId),
  ],
);

export const userSettings = pgTable(
  "user_settings",
  {
    ...owned(),
    theme: text("theme", { enum: THEMES }).notNull().default("system"),
    /** User-renamed highlight labels; missing keys fall back to DEFAULT_HIGHLIGHT_LABELS. */
    highlightLabels: jsonb("highlight_labels").$type<Partial<Record<HighlightColor, string>>>(),
    readerPrefs: jsonb("reader_prefs"),
    ...timestamps(),
  },
  (t) => [
    unique("user_settings_user_id_key").on(t.userId),
    check("user_settings_theme_check", oneOf(t.theme, THEMES)),
    ...ownRowsOnly("user_settings", t.userId),
  ],
);

/** Every table, keyed by its SQL name. */
export const tables = {
  documents,
  reading_state: readingState,
  annotations,
  notes,
  collections,
  collection_documents: collectionDocuments,
  user_settings: userSettings,
} as const satisfies Record<TableName, unknown>;
