import "server-only";
import { type PublicEnv, publicEnv } from "@/env";

export type HealthResult = { ok: true; latencyMs: number } | { ok: false; reason: string };

export const HEALTH_TIMEOUT_MS = 5_000;

/** Calls Supabase Auth's health endpoint: one cheap request that proves the URL and publishable key work. */
export async function checkSupabaseHealth(): Promise<HealthResult> {
  let env: PublicEnv;
  try {
    env = publicEnv();
  } catch (error) {
    // The message names the bad variables without their values.
    console.error(error instanceof Error ? error.message : error);
    return { ok: false, reason: "Supabase environment variables are missing or invalid" };
  }

  const startedAt = performance.now();
  try {
    const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/auth/v1/health`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    // Release the connection: an unread body keeps the socket busy until GC.
    await response.body?.cancel();
    if (!response.ok) {
      return { ok: false, reason: `Auth health returned HTTP ${response.status}` };
    }
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      reason: timedOut ? `No answer within ${HEALTH_TIMEOUT_MS} ms` : "Network error",
    };
  }
}
