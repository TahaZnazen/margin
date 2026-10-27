import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";
import { loadLocalEnv, pgConnection } from "./src/connection";

// `generate` and `check` only read the schema; every other command talks to the database, which is
// always the dev project (margin-dev) from the environment or apps/web/.env.local.
// drizzle-kit runs from packages/db (see package.json), so the repo root is two levels up.
const offline = process.argv.some((arg) => arg === "generate" || arg === "check");
if (!offline) loadLocalEnv(resolve(process.cwd(), "../.."));

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  // Supabase owns every other schema (auth, storage, …); custom migrations touch those by hand.
  schemaFilter: ["public"],
  ...(offline ? {} : { dbCredentials: pgConnection() }),
  strict: true,
  verbose: true,
});
