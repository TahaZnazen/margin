import { describe, expect, it } from "vitest";
import { buildCitation } from "./citation";

const base = {
  quote: "Hello",
  title: "Book",
  page: 4,
  origin: "https://m.test",
  documentId: "doc1",
};

describe("buildCitation", () => {
  it("links a saved highlight with #a=", () => {
    const c = buildCitation({ ...base, annotationId: "ann1" });
    expect(c.text).toBe('"Hello" — Book, p. 5\nhttps://m.test/app/read/doc1#a=ann1');
    expect(c.html).toContain('href="https://m.test/app/read/doc1#a=ann1"');
  });
  it("links a plain selection with the 1-based #p=", () => {
    expect(buildCitation(base).url).toBe("https://m.test/app/read/doc1#p=5");
  });
  it("escapes quote and title in the HTML only", () => {
    const c = buildCitation({ ...base, quote: '<img src=x onerror="a()">', title: "A & <b>B</b>" });
    expect(c.html).not.toContain("<img");
    expect(c.html).not.toContain("<b>");
    expect(c.html).toContain("&lt;img src=x onerror=&quot;a()&quot;&gt;");
    expect(c.html).toContain("A &amp; &lt;b&gt;B&lt;/b&gt;");
    expect(c.text).toContain("<img");
  });
});
