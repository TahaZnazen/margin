import { describe, expect, it } from "vitest";
import {
  contentsWithTags,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  normalizeTag,
  normalizeTags,
  parseTags,
  serializeTags,
  splitContentsTags,
  tagCounts,
} from "./tags";

describe("normalizeTag", () => {
  it("lowercases, trims, turns spaces into dashes and drops the #", () => {
    expect(normalizeTag("  #Renal System ")).toBe("renal-system");
    expect(normalizeTag("##Exam 2")).toBe("exam-2");
    expect(normalizeTag("É-Café")).toBe("é-café");
  });
  it("drops punctuation and collapses dashes", () => {
    expect(normalizeTag("a,b!  c")).toBe("ab-c");
    expect(normalizeTag("--x---y--")).toBe("x-y");
  });
  it("returns null for nothing usable", () => {
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag(" # ")).toBeNull();
    expect(normalizeTag("!!!")).toBeNull();
  });
  it("caps the length", () => {
    const tag = normalizeTag("a".repeat(50));
    expect(tag).toHaveLength(MAX_TAG_LENGTH);
  });
});

describe("normalizeTags", () => {
  it("dedupes after normalizing, keeping first order", () => {
    expect(normalizeTags(["Renal", "#renal", "exam 2", "RENAL ", "exam-2"])).toEqual([
      "renal",
      "exam-2",
    ]);
  });
  it("keeps at most 10", () => {
    const many = Array.from({ length: 15 }, (_, i) => `t${i}`);
    expect(normalizeTags(many)).toHaveLength(MAX_TAGS);
  });
});

describe("parseTags / serializeTags", () => {
  it("reads the JSON text column and arrays", () => {
    expect(parseTags('["Renal","exam-2"]')).toEqual(["renal", "exam-2"]);
    expect(parseTags(["a", "A"])).toEqual(["a"]);
  });
  it("tolerates garbage", () => {
    expect(parseTags("not json")).toEqual([]);
    expect(parseTags("{}")).toEqual([]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags("[1,2]")).toEqual([]);
  });
  it("round-trips", () => {
    expect(parseTags(serializeTags(["B", "a"]))).toEqual(["b", "a"]);
  });
});

describe("tagCounts", () => {
  it("counts and orders by use then name", () => {
    expect(tagCounts([["b", "a"], ["b"], ["c"]])).toEqual([
      { tag: "b", count: 2 },
      { tag: "a", count: 1 },
      { tag: "c", count: 1 },
    ]);
  });
});

describe("PDF contents", () => {
  it("appends tags on a last line and reads them back", () => {
    const contents = contentsWithTags("My thought", ["renal", "exam-2"]);
    expect(contents).toBe("My thought\n#renal #exam-2");
    expect(splitContentsTags(contents)).toEqual({
      comment: "My thought",
      tags: ["renal", "exam-2"],
    });
  });
  it("works without a comment", () => {
    expect(contentsWithTags(null, ["a"])).toBe("#a");
    expect(splitContentsTags("#a #b")).toEqual({ comment: null, tags: ["a", "b"] });
  });
  it("leaves comments without tags alone", () => {
    expect(contentsWithTags("hi", [])).toBe("hi");
    expect(splitContentsTags("see #1 in text")).toEqual({ comment: "see #1 in text", tags: [] });
    expect(splitContentsTags("a\nnot #tag only")).toEqual({
      comment: "a\nnot #tag only",
      tags: [],
    });
  });
});
