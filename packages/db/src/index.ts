/**
 * @margin/db: Drizzle schema, SQL migrations and RLS policies (Contract: docs/ARCHITECTURE.md §3).
 *
 * Migrations live in packages/db/migrations. `pnpm db:generate` creates a new one from the schema,
 * `pnpm db:migrate` applies them to the project in apps/web/.env.local (margin-dev).
 */
import type {
  annotations,
  collectionDocuments,
  collections,
  documents,
  notes,
  readingState,
  userSettings,
} from "./schema";

export * from "./schema";

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type ReadingState = typeof readingState.$inferSelect;
export type NewReadingState = typeof readingState.$inferInsert;
export type Annotation = typeof annotations.$inferSelect;
export type NewAnnotation = typeof annotations.$inferInsert;
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;
export type CollectionDocument = typeof collectionDocuments.$inferSelect;
export type NewCollectionDocument = typeof collectionDocuments.$inferInsert;
export type UserSettings = typeof userSettings.$inferSelect;
export type NewUserSettings = typeof userSettings.$inferInsert;

/** The private Supabase Storage bucket for PDFs, covers and snapshots. Paths start with `{user_id}/`. */
export const DOCUMENTS_BUCKET = "documents";
