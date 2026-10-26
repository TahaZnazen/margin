import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkSupabaseHealth, HEALTH_TIMEOUT_MS } from "./health";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

describe("checkSupabaseHealth", () => {
  it("is OK when Auth answers 200, and sends the publishable key", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkSupabaseHealth()).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/auth/v1/health",
      expect.objectContaining({ headers: { apikey: "sb_publishable_test" } }),
    );
  });

  it("keeps a path in the project URL (self-hosted or proxied Supabase)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.com/supabase/");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await checkSupabaseHealth();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/supabase/auth/v1/health",
      expect.anything(),
    );
  });

  it("fails with the HTTP status when Auth rejects the call", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 401 }));
    await expect(checkSupabaseHealth()).resolves.toEqual({
      ok: false,
      reason: "Auth health returned HTTP 401",
    });
  });

  it("fails on a network error", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(checkSupabaseHealth()).resolves.toEqual({ ok: false, reason: "Network error" });
  });

  it("fails on a timeout", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    await expect(checkSupabaseHealth()).resolves.toEqual({
      ok: false,
      reason: `No answer within ${HEALTH_TIMEOUT_MS} ms`,
    });
  });

  it("fails without calling the network when env is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkSupabaseHealth()).resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
