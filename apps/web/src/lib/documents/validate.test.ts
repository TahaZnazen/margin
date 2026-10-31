import { describe, expect, it } from "vitest";
import { chooseTitle } from "./validate";

describe("chooseTitle", () => {
  it("keeps real metadata", () => {
    expect(chooseTitle("Margin existing annotations fixture", "annotations.pdf", "Big line")).toBe(
      "Margin existing annotations fixture",
    );
  });
  it("uses the derived title when metadata is empty", () => {
    expect(chooseTitle(undefined, "arxiv-2210.13502v1.pdf", "Area-law")).toBe("Area-law");
  });
  it("treats metadata equal to the file name as empty", () => {
    expect(chooseTitle("arxiv-2210.13502v1", "arxiv-2210.13502v1.pdf", "Area-law")).toBe(
      "Area-law",
    );
    expect(chooseTitle("Scan.PDF", "scan.pdf", undefined)).toBe("scan");
  });
  it("falls back to the file name", () => {
    expect(chooseTitle("  ", "my book.pdf", undefined)).toBe("my book");
    expect(chooseTitle(undefined, ".pdf", undefined)).toBe("Untitled");
  });
});
