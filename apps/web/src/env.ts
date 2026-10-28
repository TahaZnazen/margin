import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ protocol: /^https?$/, error: "must be the project URL" }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string({ error: "is required" })
    .startsWith("sb_publishable_", "must be a publishable key (sb_publishable_…)"),
  // Optional here so the health check and unit tests need no PowerSync; the app shell uses powersyncUrl().
  NEXT_PUBLIC_POWERSYNC_URL: z
    .url({ protocol: /^https?$/, error: "must be the PowerSync instance URL" })
    .optional(),
});

const serverSchema = publicSchema.extend({
  SUPABASE_SECRET_KEY: z
    .string({ error: "is required" })
    .startsWith("sb_secret_", "must be a secret key (sb_secret_…)"),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function parse<T extends z.ZodType>(
  schema: T,
  values: Record<string, string | undefined>,
): z.infer<T> {
  const result = schema.safeParse(values);
  if (!result.success) {
    // Name the variables, never echo their values: a secret may sit in the wrong one.
    const problems = result.error.issues.map(
      (issue) => `  ${issue.path.join(".")} ${issue.message}`,
    );
    throw new Error(
      `Invalid environment variables:\n${problems.join("\n")}\n` +
        "Set them in apps/web/.env.local (see apps/web/.env.example).",
    );
  }
  return result.data;
}

// Read by literal name: Next.js inlines only `process.env.NEXT_PUBLIC_*` member accesses.
function readPublicVars() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_POWERSYNC_URL: process.env.NEXT_PUBLIC_POWERSYNC_URL,
  };
}

/**
 * Public config, safe in the browser. Validated on call, not at import,
 * so `next build` and unit tests work without a .env.local.
 */
export function publicEnv(): PublicEnv {
  return parse(publicSchema, readPublicVars());
}

/** The PowerSync instance URL; throws a clear error when it is not set. */
export function powersyncUrl(): string {
  const url = publicEnv().NEXT_PUBLIC_POWERSYNC_URL;
  if (!url) throw new Error("NEXT_PUBLIC_POWERSYNC_URL is required (see apps/web/.env.example).");
  return url;
}

/**
 * Whether the sign-up form is offered (`ALLOW_SIGNUPS=true`, default false). This only hides the UI
 * and gates the server action; the real guard is "Allow new users to sign up" in the Supabase dashboard.
 */
export function signupsAllowed(value: string | undefined = process.env.ALLOW_SIGNUPS): boolean {
  return value?.trim().toLowerCase() === "true";
}

/** Server config, including secrets. */
export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() must not run in the browser.");
  }
  return parse(serverSchema, {
    ...readPublicVars(),
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  });
}
