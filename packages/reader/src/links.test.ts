import { describe, expect, it } from "vitest";
import { externalLinkLabel, internalLinkLabel, safeExternalUrl } from "./links";

describe("safeExternalUrl", () => {
  it("allows http, https and mailto", () => {
    expect(safeExternalUrl("https://example.org/a?b=1")).toBe("https://example.org/a?b=1");
    expect(safeExternalUrl(" http://example.org ")).toBe("http://example.org/");
    expect(safeExternalUrl("mailto:a@example.org")).toBe("mailto:a@example.org");
  });

  it("refuses everything else", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "file:///etc/passwd",
      "ftp://example.org",
      "vbscript:x",
      "/relative/path",
      "not a url",
      "",
      null,
      undefined,
    ]) {
      expect(safeExternalUrl(bad)).toBeNull();
    }
  });
});

describe("link labels", () => {
  it("names internal links by page and external ones by host", () => {
    expect(internalLinkLabel(11)).toBe("Go to page 12");
    expect(externalLinkLabel("https://www.example.org/x")).toBe("Open link to example.org");
    expect(externalLinkLabel("mailto:a@example.org")).toBe("Email a@example.org");
  });
});
