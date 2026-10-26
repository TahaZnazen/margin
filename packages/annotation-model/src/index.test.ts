import { describe, expect, it } from "vitest";
import { packageName } from "./index";

describe("@margin/annotation-model", () => {
  it("is wired into the unit test project", () => {
    expect(packageName).toBe("@margin/annotation-model");
  });
});
