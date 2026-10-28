import { describe, expect, it } from "vitest";
import { backoffMs, isTransient } from "./errors";

describe("upload error policy", () => {
  it("retries network failures and 5xx", () => {
    expect(isTransient({ message: "TypeError: Failed to fetch" })).toBe(true);
    expect(isTransient({ status: 0 })).toBe(true);
    expect(isTransient({ status: 503 })).toBe(true);
    expect(isTransient({ code: "08006", status: 400 })).toBe(true);
    expect(isTransient({ code: "57P01", status: 500 })).toBe(true);
  });

  it("retries an expired token", () => {
    expect(isTransient({ code: "PGRST301", status: 401 })).toBe(true);
    expect(isTransient({ status: 401 })).toBe(true);
  });

  it("drops constraint and RLS violations", () => {
    expect(isTransient({ code: "23514", status: 400 })).toBe(false);
    expect(isTransient({ code: "23503", status: 409 })).toBe(false);
    expect(isTransient({ code: "42501", status: 403 })).toBe(false);
    expect(isTransient({ code: "21000", status: 500 })).toBe(false);
    expect(isTransient({ status: 400, message: "bad" })).toBe(false);
  });

  it("backs off exponentially up to a cap", () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => backoffMs(n))).toEqual([
      500, 1000, 2000, 4000, 5000, 5000,
    ]);
  });
});
