import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { brandColors } from "./brand-colors";

const tokens = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
const firstValue = (name: string) =>
  tokens.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`))?.[1]?.toLowerCase();

describe("brandColors", () => {
  it("match the light-theme tokens in tokens.css", () => {
    expect(brandColors.background).toBe(firstValue("--bg"));
    expect(brandColors.accent).toBe(firstValue("--accent"));
  });
});
