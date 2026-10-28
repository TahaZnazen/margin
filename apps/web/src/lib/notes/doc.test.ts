import { describe, expect, it } from "vitest";
import { appendQuote, EMPTY_DOC, plainTextOf, quoteIdsOf, rewriteQuoteIds } from "./doc";

const attrs = { annotationId: "a1", quoteSnapshot: "A quoted line.", color: "key", page: 3 };

describe("notebook JSON helpers", () => {
  it("appends a quote and reuses a trailing empty paragraph", () => {
    const doc = appendQuote(EMPTY_DOC, attrs);
    expect(doc.content?.map((n) => n.type)).toEqual(["annotationQuote", "paragraph"]);
    expect(quoteIdsOf(doc)).toEqual(new Set(["a1"]));
  });

  it("derives plain text from text and quote snapshots", () => {
    const doc = appendQuote(
      {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
      },
      attrs,
    );
    expect(plainTextOf(doc)).toBe("Hello\nA quoted line.");
  });

  it("points quotes of merged highlights at the survivor, nested ones included", () => {
    const quote = (id: string) => ({
      type: "annotationQuote",
      attrs: { ...attrs, annotationId: id },
    });
    const doc = {
      type: "doc",
      content: [
        quote("b1"),
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [quote("a1"), quote("b1")] }],
        },
      ],
    };
    const next = rewriteQuoteIds(doc, new Map([["b1", "a1"]]));
    expect(quoteIdsOf(next)).toEqual(new Set(["a1"]));
    expect(quoteIdsOf(doc)).toEqual(new Set(["b1", "a1"]));
    expect(rewriteQuoteIds(doc, new Map([["zz", "a1"]]))).toBe(doc);
  });

  it("finds quotes nested in lists", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "annotationQuote", attrs }] }],
        },
      ],
    };
    expect(quoteIdsOf(doc).has("a1")).toBe(true);
  });
});
