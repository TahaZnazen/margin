import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/env";

/** Supabase client for Client Components. `createBrowserClient` returns a singleton. */
export function createClient() {
  const env = publicEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
