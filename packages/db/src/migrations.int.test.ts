import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgConnection } from "./connection";
import { TABLE_NAMES } from "./schema";

/** Runs against the dev project (margin-dev) after `pnpm db:migrate`. */

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf8")) as {
  entries: unknown[];
};

const client = new pg.Client(pgConnection());

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

const applied = async () =>
  (await client.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n;

describe("migrations", () => {
  it("are all applied, and re-running them is a no-op", async () => {
    expect(await applied()).toBe(journal.entries.length);
    await migrate(drizzle({ client }), { migrationsFolder });
    expect(await applied()).toBe(journal.entries.length);
  });

  it("leave no public table without RLS and owner policies", async () => {
    const { rows } = await client.query<{ name: string; rls: boolean; policies: number }>(`
      SELECT c.relname AS name, c.relrowsecurity AS rls,
             (SELECT count(*)::int FROM pg_policies p
               WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`);
    expect(rows.map((row) => row.name)).toEqual([...TABLE_NAMES].sort());
    for (const row of rows) {
      expect(row, row.name).toMatchObject({ rls: true, policies: 4 });
    }
  });

  it("give anon no table privileges", async () => {
    const { rows } = await client.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'anon' AND table_schema = 'public'`,
    );
    expect(rows).toEqual([]);
  });

  it("publish exactly the synced tables to PowerSync", async () => {
    const { rows } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_publication_tables WHERE pubname = 'powersync' ORDER BY tablename",
    );
    expect(rows.map((row) => row.tablename)).toEqual([...TABLE_NAMES].sort());
  });

  it("0004 added chapter_progress and documents.reading_status, with grants and the updated_at trigger", async () => {
    const column = await client.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'reading_status'`,
    );
    expect(column.rows).toEqual([{ is_nullable: "YES" }]);
    const trigger = await client.query(
      `SELECT tgname FROM pg_trigger WHERE tgname = 'chapter_progress_set_updated_at'`,
    );
    expect(trigger.rowCount).toBe(1);
    const grants = await client.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'authenticated' AND table_schema = 'public' AND table_name = 'chapter_progress'
       ORDER BY privilege_type`,
    );
    expect(grants.rows.map((row) => row.privilege_type)).toEqual([
      "DELETE",
      "INSERT",
      "SELECT",
      "UPDATE",
    ]);
  });

  it("create the private documents bucket with its four owner policies", async () => {
    const bucket = await client.query(
      "SELECT public, file_size_limit FROM storage.buckets WHERE id = 'documents'",
    );
    expect(bucket.rows).toEqual([{ public: false, file_size_limit: "52428800" }]);
    const policies = await client.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'documents_bucket_%'
       ORDER BY policyname`,
    );
    expect(policies.rows.map((row) => row.policyname)).toEqual([
      "documents_bucket_delete_own",
      "documents_bucket_insert_own",
      "documents_bucket_select_own",
      "documents_bucket_update_own",
    ]);
  });
});
