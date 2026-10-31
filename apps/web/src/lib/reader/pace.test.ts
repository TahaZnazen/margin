import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatTimeLeft,
  libraryProgressLine,
  paceSecondsPerPage,
  secondsLeftInBook,
  secondsLeftInRange,
} from "./pace";

describe("paceSecondsPerPage", () => {
  it("is null with no data", () => {
    expect(paceSecondsPerPage(0, 0)).toBeNull();
  });
  it("is null after too few pages or too little time", () => {
    expect(paceSecondsPerPage(600, 2)).toBeNull();
    expect(paceSecondsPerPage(119, 10)).toBeNull();
  });
  it("is seconds per page once both thresholds pass", () => {
    expect(paceSecondsPerPage(120, 3)).toBe(40);
  });
});

describe("time left", () => {
  it("long book", () => {
    // 60 s/page, 1000 pages, on page index 99: 900 pages after it + half of this one = about 15 h
    const left = secondsLeftInBook(60, 99, 1000);
    expect(left).toBe(900.5 * 60);
    expect(formatTimeLeft(left as number)).toBe("about 15 h left");
  });
  it("is null on the last page or without a pace", () => {
    expect(secondsLeftInBook(60, 10, 10)).toBeNull();
    expect(secondsLeftInBook(null, 1, 10)).toBeNull();
  });
  it("chapter range", () => {
    expect(secondsLeftInRange(30, 4, 10)).toBe(5.5 * 30);
    expect(secondsLeftInRange(30, 10, 10)).toBeNull();
  });
});

describe("formatDuration", () => {
  it("rounds", () => {
    expect(formatDuration(20)).toBe("under 1 min");
    expect(formatDuration(12 * 60 + 20)).toBe("12 min");
    expect(formatDuration(59 * 60)).toBe("59 min");
    expect(formatDuration(100 * 60)).toBe("2 h");
    expect(formatDuration(65 * 60)).toBe("1 h");
  });
});

describe("libraryProgressLine", () => {
  it("is null for a book never opened", () => {
    expect(
      libraryProgressLine({ page: null, pageCount: 9, percent: 0, secondsRead: 0 }),
    ).toBeNull();
    expect(libraryProgressLine({ page: 0, pageCount: 9, percent: 0, secondsRead: 400 })).toBeNull();
  });
  it("shows page and percent without a pace", () => {
    expect(libraryProgressLine({ page: 4, pageCount: 9, percent: 50, secondsRead: 30 })).toBe(
      "p. 5 of 9 · 50 %",
    );
  });
  it("adds time left with a pace", () => {
    expect(libraryProgressLine({ page: 4, pageCount: 9, percent: 50, secondsRead: 240 })).toBe(
      "p. 5 of 9 · 50 % · about 5 min left",
    );
  });
});
