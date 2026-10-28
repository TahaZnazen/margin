/** Pure helpers over Tiptap JSON (no editor needed): text, quote ids, quote insertion. */
export interface JsonNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export interface QuoteAttrs {
  annotationId: string;
  quoteSnapshot: string;
  color: string | null;
  page: number;
}

export const EMPTY_DOC: JsonNode = { type: "doc", content: [{ type: "paragraph" }] };

export function asDoc(value: unknown): JsonNode {
  return value && typeof value === "object" && (value as JsonNode).type === "doc"
    ? (value as JsonNode)
    : EMPTY_DOC;
}

const BLOCKS = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "listItem",
  "taskItem",
  "codeBlock",
  "annotationQuote",
]);

/** Plain text for search: block nodes separated by newlines; quotes contribute their snapshot. */
export function plainTextOf(node: JsonNode): string {
  const parts: string[] = [];
  const walk = (n: JsonNode) => {
    if (n.type === "annotationQuote") {
      parts.push(String(n.attrs?.quoteSnapshot ?? ""), "\n");
      return;
    }
    if (n.text) parts.push(n.text);
    for (const child of n.content ?? []) walk(child);
    if (n.type && BLOCKS.has(n.type)) parts.push("\n");
  };
  walk(node);
  return parts
    .join("")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function quoteIdsOf(node: JsonNode): Set<string> {
  const ids = new Set<string>();
  const walk = (n: JsonNode) => {
    if (n.type === "annotationQuote" && typeof n.attrs?.annotationId === "string") {
      ids.add(n.attrs.annotationId);
    }
    for (const child of n.content ?? []) walk(child);
  };
  walk(node);
  return ids;
}

/** Points quote nodes at other annotations (`from id -> to id`); returns the same doc if none match. */
export function rewriteQuoteIds(doc: JsonNode, map: ReadonlyMap<string, string>): JsonNode {
  const walk = (n: JsonNode): JsonNode => {
    let next = n;
    if (n.type === "annotationQuote") {
      const to = map.get(String(n.attrs?.annotationId));
      if (to) next = { ...n, attrs: { ...n.attrs, annotationId: to } };
    }
    if (n.content) {
      const content = n.content.map(walk);
      if (content.some((child, i) => child !== n.content?.[i])) next = { ...next, content };
    }
    return next;
  };
  return walk(doc);
}

export const quoteNode = (attrs: QuoteAttrs): JsonNode => ({
  type: "annotationQuote",
  attrs: { ...attrs },
});

/** Appends a quote block at the end of the document (a trailing empty paragraph is reused). */
export function appendQuote(doc: JsonNode, attrs: QuoteAttrs): JsonNode {
  const content = [...(doc.content ?? [])];
  const last = content.at(-1);
  if (last?.type === "paragraph" && !last.content?.length) content.pop();
  content.push(quoteNode(attrs), { type: "paragraph" });
  return { ...doc, content };
}
