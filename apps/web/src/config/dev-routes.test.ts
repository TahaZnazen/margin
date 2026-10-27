import { describe, expect, it } from "vitest";
import { devRoutesEnabled } from "./dev-routes";

describe("devRoutesEnabled", () => {
  it("is on locally and on preview deployments", () => {
    expect(devRoutesEnabled({})).toBe(true);
    expect(devRoutesEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(devRoutesEnabled({ VERCEL_ENV: "preview" })).toBe(true);
  });

  it("is off on the production deployment", () => {
    expect(devRoutesEnabled({ VERCEL_ENV: "production", NODE_ENV: "production" })).toBe(false);
  });
});
