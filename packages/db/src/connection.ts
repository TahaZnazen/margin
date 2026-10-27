import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Direct Postgres connection settings for migrations, scripts and integration tests (Node only;
 * not exported from the package entry, so it never reaches a browser bundle).
 *
 * - `DATABASE_URL`: the margin-dev connection string (session pooler).
 * - `DATABASE_CA_CERT`: Supabase's root CA, as a file path or as the PEM text itself. Supabase's
 *   certificate chains to its own CA, which isn't in Node's trust store, so without it the
 *   connection fails with SELF_SIGNED_CERT_IN_CHAIN. Verification is never turned off.
 *
 * Both are read from the environment first, then from apps/web/.env.local.
 */
export interface PgConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: { ca?: string; rejectUnauthorized: true };
}

/** Loads apps/web/.env.local, given the repo root. Values already in the environment win. */
export function loadLocalEnv(repoRoot: string): void {
  const file = join(repoRoot, "apps", "web", ".env.local");
  if (existsSync(file)) process.loadEnvFile(file);
}

function readCa(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.trimStart().startsWith("-----BEGIN")) return value;
  if (!existsSync(value)) {
    throw new Error(`DATABASE_CA_CERT points to ${value}, which doesn't exist.`);
  }
  return readFileSync(value, "utf8");
}

/** Parses DATABASE_URL into explicit settings, so `sslmode` in the URL can't weaken TLS. */
export function pgConnection(env: NodeJS.ProcessEnv = process.env): PgConnection {
  const raw = env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      "DATABASE_URL is missing. Add it to apps/web/.env.local (see apps/web/.env.example).",
    );
  }
  const url = new URL(raw);
  const ca = readCa(env.DATABASE_CA_CERT);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)) || "postgres",
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true },
  };
}
