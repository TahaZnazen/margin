import { readFileSync } from "node:fs";
import { TABLE_NAMES, tables } from "@margin/db";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { AppSchema } from "./schema";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** The SQLite type PowerSync gives a Postgres column. */
function sqliteType(drizzleColumnType: string): string {
  if (["PgInteger", "PgBigInt53", "PgBoolean"].includes(drizzleColumnType)) return "INTEGER";
  if (drizzleColumnType === "PgReal") return "REAL";
  return "TEXT";
}

describe("PowerSync client schema", () => {
  it("has exactly the database tables", () => {
    expect(AppSchema.tables.map((table) => table.name).sort()).toEqual([...TABLE_NAMES].sort());
  });

  it.each(TABLE_NAMES)("mirrors every column of %s with the right SQLite type", (name) => {
    const expected = getTableConfig(tables[name])
      .columns.filter((column) => column.name !== "id") // PowerSync adds id itself
      .map((column) => [column.name, sqliteType(column.columnType)]);
    const local = AppSchema.tables.find((table) => table.name === name);
    const actual = local?.columns.map((column) => [column.name, column.type]);
    expect(actual?.sort()).toEqual(expected.sort());
  });

  it("validates", () => {
    expect(() => AppSchema.validate()).not.toThrow();
  });
});

describe("sync config (powersync.yaml)", () => {
  const yaml = read("../powersync.yaml");

  it("uses Sync Streams (edition 3), not legacy sync rules", () => {
    expect(yaml).toMatch(/^config:\n {2}edition: 3$/m);
    expect(yaml).not.toMatch(/bucket_definitions/);
  });

  it("syncs every table, each scoped to the signed-in user", () => {
    const queries = [...yaml.matchAll(/^\s+- (SELECT .+)$/gm)].map((match) => match[1]);
    expect(queries).toEqual(
      TABLE_NAMES.map((table) => `SELECT * FROM ${table} WHERE user_id = auth.user_id()`),
    );
  });

  it("matches the tables in the powersync publication", () => {
    const migration = read("../../db/migrations/0003_powersync_publication.sql");
    const added = read("../../db/migrations/0004_chapter_progress.sql");
    const published = [
      ...[...migration.matchAll(/public\.(\w+)/g)].map((match) => match[1]),
      ...[...added.matchAll(/alter publication powersync add table public\.(\w+)/gi)].map(
        (match) => match[1],
      ),
    ];
    expect(published).toEqual([...TABLE_NAMES]);
  });
});
