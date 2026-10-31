import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFlagList } from "./flags";

describe("parseFlagList", () => {
  it("is empty for undefined and blank values", () => {
    expect(parseFlagList(undefined).size).toBe(0);
    expect(parseFlagList("").size).toBe(0);
    expect(parseFlagList(" , ,").size).toBe(0);
  });
  it("splits on commas and trims", () => {
    expect([...parseFlagList(" chapterProgress , ai,, ")]).toEqual(["chapterProgress", "ai"]);
  });
});

describe("flags", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps chapterProgress off by default, so no chapter UI ships", async () => {
    vi.stubEnv("NEXT_PUBLIC_MARGIN_FLAGS", "");
    vi.resetModules();
    expect((await import("./flags")).flags.chapterProgress).toBe(false);
  });

  it("turns chapterProgress on when the build names it", async () => {
    vi.stubEnv("NEXT_PUBLIC_MARGIN_FLAGS", "ai, chapterProgress");
    vi.resetModules();
    const mod = await import("./flags");
    expect(mod.flags.chapterProgress).toBe(true);
    expect(mod.flags.billing).toBe(false);
  });
});
