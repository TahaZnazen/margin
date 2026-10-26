import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { pgConnection } from "./connection";
import { TABLE_NAMES, tables } from "./schema";

describe("schema invariants", () => {
  it("lists every table once", () => {
    expect(Object.keys(tables).sort()).toEqual([...TABLE_NAMES].sort());
  });

  describe.each(TABLE_NAMES)("%s", (name) => {
    const config = getTableConfig(tables[name]);
    const columns = config.columns.map((column) => column.name);

    it("has the shared columns", () => {
      expect(columns.slice(0, 2)).toEqual(["id", "user_id"]);
      expect(columns.slice(-3)).toEqual(["created_at", "updated_at", "deleted_at"]);
      const byName = new Map(config.columns.map((column) => [column.name, column]));
      expect(byName.get("id")?.primary).toBe(true);
      expect(byName.get("user_id")?.notNull).toBe(true);
      expect(byName.get("updated_at")?.notNull).toBe(true);
      expect(byName.get("deleted_at")?.notNull).toBe(false);
    });

    it("cascades from auth.users", () => {
      const toUsers = config.foreignKeys
        .map((fk) => fk.reference())
        .filter((ref) => getTableConfig(ref.foreignTable).name === "users");
      expect(toUsers).toHaveLength(1);
      expect(toUsers[0]?.columns.map((c) => c.name)).toEqual(["user_id"]);
      expect(config.foreignKeys.every((fk) => fk.onDelete === "cascade")).toBe(true);
    });

    it("has RLS for select, insert, update and delete on the owner only", () => {
      expect(config.policies.map((p) => p.for).sort()).toEqual([
        "delete",
        "insert",
        "select",
        "update",
      ]);
      for (const policy of config.policies) {
        expect(policy.as ?? "permissive").toBe("permissive");
        expect(policy.to).toMatchObject({ name: "authenticated" });
        if (policy.for !== "insert") expect(policy.using).toBeDefined();
        if (policy.for === "insert" || policy.for === "update") {
          expect(policy.withCheck).toBeDefined();
        }
      }
    });

    it("references parents through (user_id, parent_id) so both rows have one owner", () => {
      const toParents = config.foreignKeys
        .map((fk) => fk.reference())
        .filter((ref) => getTableConfig(ref.foreignTable).name !== "users");
      for (const ref of toParents) {
        expect(ref.columns[0]?.name).toBe("user_id");
        expect(ref.foreignColumns.map((c) => c.name)).toEqual(["user_id", "id"]);
      }
    });
  });
});

describe("pgConnection", () => {
  const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

  it("parses the URL into explicit settings and always verifies TLS", () => {
    const connection = pgConnection(
      env({
        DATABASE_URL:
          "postgresql://postgres.ref:p%40ss%2Fword@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=disable",
      }),
    );
    expect(connection).toEqual({
      host: "aws-0-eu-west-1.pooler.supabase.com",
      port: 5432,
      user: "postgres.ref",
      password: "p@ss/word",
      database: "postgres",
      ssl: { rejectUnauthorized: true },
    });
  });

  it("uses DATABASE_CA_CERT given as PEM text", () => {
    const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
    const connection = pgConnection(
      env({ DATABASE_URL: "postgresql://u:p@h/db", DATABASE_CA_CERT: pem }),
    );
    expect(connection.ssl).toEqual({ ca: pem, rejectUnauthorized: true });
    expect(connection.port).toBe(5432);
  });

  it("fails clearly when the URL or the CA file is missing", () => {
    expect(() => pgConnection(env({}))).toThrow(/DATABASE_URL is missing/);
    expect(() =>
      pgConnection(
        env({ DATABASE_URL: "postgresql://u:p@h/db", DATABASE_CA_CERT: "./no-such-file.crt" }),
      ),
    ).toThrow(/doesn't exist/);
  });
});
