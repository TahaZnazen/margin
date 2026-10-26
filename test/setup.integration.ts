import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Integration tests run against the dev Supabase project (`margin-dev`), never production.
// Locally the values come from apps/web/.env.local; in CI they come from repository secrets.
// Variables already set in the environment win over the file.
const envFile = fileURLToPath(new URL("../apps/web/.env.local", import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "DATABASE_URL",
  // Supabase's root CA (PEM text or a file path): Postgres TLS is always verified.
  "DATABASE_CA_CERT",
] as const;

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(
    `Integration tests need ${missing.join(", ")}. ` +
      "Locally, fill them in apps/web/.env.local (see apps/web/.env.example). " +
      "In CI, add them as GitHub repository secrets.",
  );
}
