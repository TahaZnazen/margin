import { describe, expect, it } from "vitest";
import { packageName } from "./index";

describe("@margin/reader", () => {
  it("is wired into the unit test project", () => {
    expect(packageName).toBe("@margin/reader");
  });
});
