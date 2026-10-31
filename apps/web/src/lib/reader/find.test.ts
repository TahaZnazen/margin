import { describe, expect, it } from "vitest";
import { findCountLabel } from "./find";

const state = (
  over: Partial<{ query: string; total: number; current: number; searching: boolean }>,
) => ({
  query: "x",
  total: 0,
  current: -1,
  searching: false,
  ...over,
});

describe("findCountLabel", () => {
  it("is empty before a query", () => {
    expect(findCountLabel(state({ query: "" }), "")).toBe("");
    expect(findCountLabel(state({}), "   ")).toBe("");
  });
  it("shows n of m, with a plus while more hits may still arrive", () => {
    expect(findCountLabel(state({ total: 17, current: 2 }), "x")).toBe("3 of 17");
    expect(findCountLabel(state({ total: 4, current: 0, searching: true }), "x")).toBe("1 of 4+");
  });
  it("says so when nothing matches, and while the search catches up with the typed text", () => {
    expect(findCountLabel(state({}), "x")).toBe("No matches");
    expect(findCountLabel(state({ searching: true }), "x")).toBe("Searching…");
    expect(findCountLabel(state({ query: "old", total: 3, current: 0 }), "new")).toBe("Searching…");
  });
});
