import { describe, expect, it } from "vitest";
import { deriveChapters, deriveTitle } from "./derive-outline";
import type { PageText, TextRun } from "./engine";

const run = (str: string, y: number, fontSize: number, x = 72): TextRun => ({
  str,
  x,
  y,
  width: str.length * fontSize * 0.5,
  fontSize,
  ascent: 0.9,
  descent: 0.2,
  angle: 0,
  fontFamily: "serif",
  dir: "ltr",
  hasEOL: true,
  start: 0,
});
const page = (runs: TextRun[]): PageText => ({ text: runs.map((r) => r.str).join("\n"), runs });
const body = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    run("Lorem ipsum dolor sit amet consectetur adipiscing elit sed do", 200 + i * 14, 11),
  );

describe("deriveChapters", () => {
  it("picks the large heading on a page and ignores body text", () => {
    const pages = [
      page([run("Origins", 90, 24), ...body(30)]),
      page(body(30)),
      page([run("Chapter 2", 80, 14), run("The long road", 110, 22), ...body(30)]),
      page(body(30)),
    ];
    const out = deriveChapters(pages);
    expect(out.map((c) => [c.title, c.page])).toEqual([
      ["Origins", 0],
      ["Chapter 2 The long road", 2],
    ]);
  });
  it("drops running headers that repeat on many pages", () => {
    const pages = Array.from({ length: 8 }, () => page([run("MY BOOK", 40, 14), ...body(30)]));
    expect(deriveChapters(pages)).toEqual([]);
  });
  it("keeps numbered chapter titles that differ only by number", () => {
    const pages = [1, 2, 3, 4].map((n) => page([run(`Chapter ${n}`, 90, 24), ...body(30)]));
    expect(deriveChapters(pages).map((c) => c.title)).toEqual([
      "Chapter 1",
      "Chapter 2",
      "Chapter 3",
      "Chapter 4",
    ]);
  });
  it("returns nothing for plain text", () => {
    expect(deriveChapters([page(body(30)), page(body(30))])).toEqual([]);
  });
});

describe("deriveTitle", () => {
  it("takes the topmost largest lines, joined, and ignores smaller text", () => {
    const p = page([
      run("Area-law entanglement from", 60, 18, 100),
      run("quantum geometry", 82, 18, 100),
      run("Jane Author", 120, 11),
      ...body(30),
    ]);
    expect(deriveTitle(p)).toBe("Area-law entanglement from quantum geometry");
  });
  it("returns undefined when nothing stands out", () => {
    expect(deriveTitle(page(body(30)))).toBeUndefined();
    expect(deriveTitle(null)).toBeUndefined();
    expect(deriveTitle(page([]))).toBeUndefined();
  });
  it("caps long titles at 120 characters on a word boundary", () => {
    const long = Array.from({ length: 40 }, () => "wordy").join(" ");
    const out = deriveTitle(page([run(long, 60, 20), ...body(30)])) ?? "";
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith("…")).toBe(true);
  });
  it("skips a lone drop cap", () => {
    expect(deriveTitle(page([run("T", 60, 40), ...body(30)]))).toBeUndefined();
  });
});
