import { beforeEach, describe, expect, it, vi } from "vitest";
import { publicEnv, serverEnv, signupsAllowed } from "./env";

describe("signupsAllowed", () => {
  it("is false unless exactly 'true'", () => {
    expect(signupsAllowed(undefined)).toBe(false);
    expect(signupsAllowed("false")).toBe(false);
    expect(signupsAllowed("1")).toBe(false);
    expect(signupsAllowed("true")).toBe(true);
  });
});

const URL_ = "https://example.supabase.co";
const PUBLISHABLE = "sb_publishable_test";
const SECRET = "sb_secret_test";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE);
  vi.stubEnv("SUPABASE_SECRET_KEY", SECRET);
});

describe("publicEnv", () => {
  it("returns the public variables", () => {
    expect(publicEnv()).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: URL_,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
    });
  });

  it("never exposes the secret key", () => {
    expect(publicEnv()).not.toHaveProperty("SUPABASE_SECRET_KEY");
  });

  it("names missing variables and points to .env.example", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    expect(() => publicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL[\s\S]*apps\/web\/\.env\.example/);
  });

  it("rejects a secret key in the publishable slot without echoing it", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_secret_leaked");
    const call = () => publicEnv();
    expect(call).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a publishable key/);
    expect(call).not.toThrow(/sb_secret_leaked/);
  });

  it("rejects a URL that isn't http(s)", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "postgres://example.supabase.co");
    expect(() => publicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL must be the project URL/);
  });
});

describe("serverEnv", () => {
  it("includes the secret key", () => {
    expect(serverEnv().SUPABASE_SECRET_KEY).toBe(SECRET);
  });

  it("requires the secret key", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", undefined);
    expect(() => serverEnv()).toThrow(/SUPABASE_SECRET_KEY is required/);
  });

  it("rejects a publishable key in the secret slot", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", PUBLISHABLE);
    expect(() => serverEnv()).toThrow(/SUPABASE_SECRET_KEY must be a secret key/);
  });
});
