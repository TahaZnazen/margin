import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Typed access to the golden PDF corpus. Node only (tests, scripts), never the client bundle. */

export const PDFS_DIR = join(dirname(fileURLToPath(import.meta.url)), "pdfs");
export const PRIVATE_DIR = join(PDFS_DIR, "private");

const rect = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const knownText = z
  .object({
    text: z.string(),
    pageIndex: z.number().int().nonnegative(),
    rect,
    tolerance: z.number(),
    inTextLayer: z.boolean(),
  })
  .passthrough();

const entry = z
  .object({
    id: z.string(),
    file: z.string(),
    title: z.string(),
    language: z.string().optional(),
    cases: z.array(z.string()),
    tests: z.string(),
    status: z.string().optional(),
    source: z
      .object({ kind: z.enum(["download", "generated"]), url: z.string().optional() })
      .passthrough(),
    license: z.object({ id: z.string(), url: z.string(), attribution: z.string() }),
    sha256: z.string().length(64),
    bytes: z.number().int().positive(),
    committed: z.boolean(),
    expected: z
      .object({
        pageCount: z.number().int().positive(),
        hasOutline: z.boolean(),
        hasTextLayer: z.boolean(),
        knownText: z.array(knownText),
      })
      .passthrough(),
    notes: z.string().optional(),
  })
  .passthrough();

const manifestSchema = z.object({
  version: z.number(),
  conventions: z.record(z.string(), z.string()),
  entries: z.array(entry),
  gaps: z.array(z.unknown()),
});

export type FixtureEntry = z.infer<typeof entry>;
export type FixtureManifest = z.infer<typeof manifestSchema>;

export const manifest: FixtureManifest = manifestSchema.parse(
  JSON.parse(readFileSync(join(PDFS_DIR, "manifest.json"), "utf8")),
);

/** True when the entry is documented but intentionally not fetched (status "skipped …"). */
export const isSkipped = (e: FixtureEntry): boolean => e.status?.startsWith("skipped") === true;

export function getFixture(id: string): FixtureEntry {
  const found = manifest.entries.find((e) => e.id === id);
  if (!found) throw new Error(`Unknown fixture id: ${id}`);
  return found;
}

/** Absolute path of a fixture file; it exists after `pnpm fixtures` unless the entry is skipped. */
export function fixturePath(id: string): string {
  return join(PDFS_DIR, getFixture(id).file);
}

/** Absolute paths of the user's own PDFs in fixtures/pdfs/private (smoke tests only). */
export function privatePdfPaths(): string[] {
  if (!existsSync(PRIVATE_DIR)) return [];
  return readdirSync(PRIVATE_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => join(PRIVATE_DIR, f));
}
