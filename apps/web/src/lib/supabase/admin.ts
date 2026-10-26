import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/env";

/**
 * Secret-key client. It bypasses RLS, so use it only for trusted server work
 * (admin tasks, tests), never to read data on a user's behalf.
 * `server-only` makes importing this from a Client Component fail the build.
 */
export function createAdminClient() {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
