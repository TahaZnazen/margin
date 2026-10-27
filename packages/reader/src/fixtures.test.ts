import { existsSync } from "node:fs";
import { fixturePath, isSkipped, manifest } from "@margin/fixtures";
import { describe, expect, it } from "vitest";

describe("@margin/fixtures is importable from another package", () => {
  it("exposes a typed manifest with expected facts and license for every entry", () => {
    expect(manifest.entries.length).toBeGreaterThan(5);
    for (const e of manifest.entries) {
      expect(e.license.id).toBeTruthy();
      expect(e.expected.pageCount).toBeGreaterThan(0);
    }
  });

  it("resolves the committed ruler PDF path", () => {
    expect(existsSync(fixturePath("ruler"))).toBe(true);
  });

  it("marks lean-MVP skips", () => {
    const skipped = manifest.entries.filter(isSkipped).map((e) => e.id);
    expect(skipped).toContain("image-heavy-astronomy");
  });
});
