/**
 * One-off: creates (or re-keys) `powersync_role`, the database role PowerSync replicates with
 * (PowerSync's Supabase guide), and grants it SELECT on the tables in the `powersync` publication
 * (migrations/0003). Safe to re-run, e.g. after a later migration adds a table to the publication.
 *
 *   pnpm db:powersync-role
 *
 * Reads DATABASE_URL, DATABASE_CA_CERT and POWERSYNC_DB_PASSWORD from the environment or
 * apps/web/.env.local. The password never appears in SQL: Postgres receives a SCRAM-SHA-256
 * verifier computed here, so statement logs can't leak it. Use the same password in the
 * PowerSync dashboard's database connection.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import pg from "pg";
import { loadLocalEnv, pgConnection } from "../src/connection.ts";

const ROLE = "powersync_role";
const MIN_PASSWORD_LENGTH = 24;

/** The SCRAM-SHA-256 verifier Postgres stores for a password (RFC 5802 / RFC 7677). */
function scramVerifier(password: string): string {
  const iterations = 4096;
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password.normalize("NFKC"), salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  const b64 = (buffer: Buffer) => buffer.toString("base64");
  return `SCRAM-SHA-256$${iterations}:${b64(salt)}$${b64(storedKey)}:${b64(serverKey)}`;
}

loadLocalEnv(resolve(import.meta.dirname, "../../.."));

const password = process.env.POWERSYNC_DB_PASSWORD;
if (!password || password.length < MIN_PASSWORD_LENGTH) {
  throw new Error(
    `Set POWERSYNC_DB_PASSWORD (at least ${MIN_PASSWORD_LENGTH} random characters) in apps/web/.env.local.`,
  );
}

const client = new pg.Client(pgConnection());
await client.connect();
try {
  await client.query("BEGIN");
  const existing = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [ROLE]);
  const verb = existing.rowCount ? "ALTER" : "CREATE";
  const verifier = client.escapeLiteral(scramVerifier(password));
  await client.query(`${verb} ROLE ${ROLE} WITH REPLICATION BYPASSRLS LOGIN PASSWORD ${verifier}`);

  const published = await client.query<{ schemaname: string; tablename: string }>(
    "SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'powersync'",
  );
  if (published.rowCount === 0) {
    throw new Error("The powersync publication has no tables. Run `pnpm db:migrate` first.");
  }
  for (const { schemaname, tablename } of published.rows) {
    const table = `${client.escapeIdentifier(schemaname)}.${client.escapeIdentifier(tablename)}`;
    await client.query(`GRANT SELECT ON TABLE ${table} TO ${ROLE}`);
  }
  await client.query("COMMIT");
  console.log(
    `${verb === "CREATE" ? "Created" : "Updated"} ${ROLE}; SELECT on ${published.rowCount} tables.`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
