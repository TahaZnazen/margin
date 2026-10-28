import { strToU8, type Zippable, zipSync } from "fflate";
import { fileStem } from "./markdown";

/** Bump when the JSON layout changes; a later "restore from backup" reads it. */
export const BACKUP_VERSION = 1;

/** Every user-owned table (docs/ARCHITECTURE.md §3), in the order of the dump. */
export const BACKUP_TABLES = [
  "documents",
  "reading_state",
  "annotations",
  "notes",
  "collections",
  "collection_documents",
  "user_settings",
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

export type BackupRows = Record<BackupTable, Record<string, unknown>[]>;

export interface BackupBook {
  id: string;
  title: string;
  markdown: string;
  pdf?: Uint8Array;
}

export interface BackupInput {
  exportedAt: string;
  tables: BackupRows;
  books: readonly BackupBook[];
}

/** The versioned JSON dump of all rows. */
export function backupJson(input: Pick<BackupInput, "exportedAt" | "tables">): string {
  return JSON.stringify(
    {
      format: "margin-backup",
      version: BACKUP_VERSION,
      exported_at: input.exportedAt,
      tables: input.tables,
    },
    null,
    2,
  );
}

/** Zip with `margin-data.json`, `books/<book>.md` and (optionally) `pdfs/<book>.pdf`. */
export function buildBackupZip(input: BackupInput): Uint8Array {
  const files: Zippable = { "margin-data.json": strToU8(backupJson(input)) };
  const used = new Set<string>();
  for (const book of input.books) {
    // UUIDv7 ids start with a timestamp, so the random tail tells books apart.
    let name = `${fileStem(book.title)}-${book.id.slice(-8)}`;
    for (let n = 2; used.has(name); n++) name = `${fileStem(book.title)}-${book.id.slice(-8)}-${n}`;
    used.add(name);
    files[`books/${name}.md`] = strToU8(book.markdown);
    if (book.pdf) files[`pdfs/${name}.pdf`] = [book.pdf, { level: 0 }];
  }
  return zipSync(files);
}
