import { describe, expect, it } from "vitest";
import { buildQuote } from "./quote";

const alphabet = "abcdefghijklmnopqrstuvwxyz";
const text = `${alphabet.repeat(2)}[HIGHLIGHT]${alphabet.toUpperCase().repeat(2)}`;
const start = text.indexOf("[");
const end = text.indexOf("]") + 1;

describe("buildQuote", () => {
  it("returns the exact text with 32 characters of context each side", () => {
    const quote = buildQuote(text, start, end);
    expect(quote.exact).toBe("[HIGHLIGHT]");
    expect(quote.prefix).toBe(text.slice(start - 32, start));
    expect(quote.prefix).toHaveLength(32);
    expect(quote.suffix).toBe(text.slice(end, end + 32));
    expect(quote.suffix).toHaveLength(32);
  });

  it("shortens the context at the start and end of the page", () => {
    expect(buildQuote("Hello world", 0, 5)).toEqual({
      exact: "Hello",
      prefix: "",
      suffix: " world",
    });
    expect(buildQuote("Hello world", 6, 11)).toEqual({
      exact: "world",
      prefix: "Hello ",
      suffix: "",
    });
  });

  it("never cuts a surrogate pair in half at the edge of the context", () => {
    // "😀" is two UTF-16 code units. Put one so the 32-unit window starts or ends inside it.
    const before = `😀${"x".repeat(31)}`; // 33 units: the window [1, 33) starts mid-emoji
    const after = `${"y".repeat(31)}😀`; // the window [0, 32) ends mid-emoji
    const quote = buildQuote(`${before}HIT${after}`, before.length, before.length + 3);
    expect(quote).toEqual({ exact: "HIT", prefix: "x".repeat(31), suffix: "y".repeat(31) });
  });

  it("keeps a whole surrogate pair inside the window", () => {
    const quote = buildQuote(`a😀HIT😀b`, 3, 6);
    expect(quote).toEqual({ exact: "HIT", prefix: "a😀", suffix: "😀b" });
  });

  it.each([
    [-1, 3],
    [3, 3],
    [5, 3],
    [0, 99],
    [0.5, 3],
    [0, Number.NaN],
  ])("rejects the range [%s, %s)", (from, to) => {
    expect(() => buildQuote("Hello world", from, to)).toThrow(RangeError);
  });
});
