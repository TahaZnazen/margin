import { describe, expect, it } from "vitest";
import { deriveChapters } from "./derive-outline";
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
  it("returns nothing for plain text", () => {
    expect(deriveChapters([page(body(30)), page(body(30))])).toEqual([]);
  });
});
