import { DEFAULT_HIGHLIGHT_LABELS, type HighlightColor } from "@margin/annotation-model";
import type { OutlineItem } from "@margin/reader";
import { groupByChapter } from "@/lib/annotations/chapters";
import type { JsonNode } from "@/lib/notes/doc";

export interface MarkdownAnnotation {
  id: string;
  kind: "highlight" | "area" | "bookmark";
  color: HighlightColor | null;
  quoteText: string | null;
  comment: string | null;
  /** 0-based. */
  pageStart: number;
  /** Distance of the first rect from the top of the page, for reading order. */
  top?: number;
}

export interface BookMarkdownInput {
  documentId: string;
  title: string;
  author: string | null;
  exportedAt: string;
  /** The app's origin, for deep links: `<origin>/app/read/<documentId>#a=<annotationId>`. */
  origin: string;
  labels?: Partial<Record<HighlightColor, string>>;
  outline: readonly OutlineItem[];
  annotations: readonly MarkdownAnnotation[];
  notebook: JsonNode | null;
}

export const deepLink = (origin: string, documentId: string, annotationId: string) =>
  `${origin.replace(/\/$/, "")}/app/read/${documentId}#a=${annotationId}`;

/** A YAML double-quoted scalar (JSON strings are valid YAML). */
const yaml = (s: string) => JSON.stringify(s);

/** Text for Markdown prose: nothing that could start raw HTML. */
const plain = (s: string) => s.replace(/</g, "\\<");

/** Every line of `text` as a blockquote line. */
const quoteLines = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => `> ${plain(l.trim())}`.trimEnd())
    .join("\n");

function annotationBlock(
  a: MarkdownAnnotation,
  input: BookMarkdownInput,
  labels: Record<string, string>,
) {
  const label = a.color ? labels[a.color] : "Highlight";
  const lines = [
    quoteLines(a.quoteText ?? ""),
    ">",
    `> **${label}** · p. ${a.pageStart + 1} · [Open in Margin](${deepLink(input.origin, input.documentId, a.id)})`,
  ];
  if (a.comment) lines.push("", ...a.comment.split("\n").map((l) => plain(l)));
  return lines.join("\n");
}

// ---- Tiptap JSON to Markdown ---------------------------------------------------------------

function marked(node: JsonNode): string {
  let text = plain(node.text ?? "");
  for (const mark of node.marks ?? []) {
    if (mark.type === "code") text = `\`${node.text ?? ""}\``;
    else if (mark.type === "bold") text = `**${text}**`;
    else if (mark.type === "italic") text = `*${text}*`;
    else if (mark.type === "strike") text = `~~${text}~~`;
    else if (mark.type === "link" && typeof mark.attrs?.href === "string") {
      text = `[${text}](${mark.attrs.href})`;
    }
  }
  return text;
}

function inline(node: JsonNode): string {
  return (node.content ?? [])
    .map((c) => (c.type === "text" ? marked(c) : c.type === "hardBreak" ? "  \n" : inline(c)))
    .join("");
}

function indent(text: string, by: string): string {
  return text
    .split("\n")
    .map((l, i) => (i === 0 ? l : l ? by + l : l))
    .join("\n");
}

function blocks(node: JsonNode, ctx: NotebookContext): string[] {
  const out: string[] = [];
  for (const child of node.content ?? []) {
    const md = block(child, ctx);
    if (md !== null) out.push(md);
  }
  return out;
}

interface NotebookContext {
  origin: string;
  documentId: string;
  byId: ReadonlyMap<string, MarkdownAnnotation>;
}

function block(node: JsonNode, ctx: NotebookContext): string | null {
  switch (node.type) {
    case "paragraph":
      return inline(node);
    case "heading":
      return `${"#".repeat(Number(node.attrs?.level ?? 2) + 1)} ${inline(node)}`;
    case "blockquote":
      return blocks(node, ctx)
        .join("\n\n")
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
    case "codeBlock":
      return `\`\`\`\n${(node.content ?? []).map((c) => c.text ?? "").join("")}\n\`\`\``;
    case "horizontalRule":
      return "---";
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const items = (node.content ?? []).map((item, i) => {
        const marker =
          node.type === "orderedList"
            ? `${Number(node.attrs?.start ?? 1) + i}. `
            : node.type === "taskList"
              ? `- [${item.attrs?.checked ? "x" : " "}] `
              : "- ";
        return marker + indent(blocks(item, ctx).join("\n"), " ".repeat(marker.length));
      });
      return items.join("\n");
    }
    case "annotationQuote": {
      const id = String(node.attrs?.annotationId ?? "");
      const live = ctx.byId.get(id);
      const text = String(live?.quoteText ?? node.attrs?.quoteSnapshot ?? "");
      const page = (live?.pageStart ?? Number(node.attrs?.page ?? 0)) + 1;
      const tail = live
        ? `p. ${page} · [Open in Margin](${deepLink(ctx.origin, ctx.documentId, id)})`
        : `p. ${page} · highlight deleted`;
      return `${quoteLines(text)}\n>\n> ${tail}`;
    }
    default:
      return node.content ? blocks(node, ctx).join("\n\n") : null;
  }
}

/** Markdown for a Tiptap document; quote nodes become linked blockquotes. No raw HTML. */
export function notebookToMarkdown(
  doc: JsonNode,
  ctx: { origin: string; documentId: string; annotations: readonly MarkdownAnnotation[] },
): string {
  const byId = new Map(ctx.annotations.map((a) => [a.id, a]));
  return blocks(doc, { origin: ctx.origin, documentId: ctx.documentId, byId })
    .filter((b) => b.trim())
    .join("\n\n");
}

/** The whole per-book export: frontmatter, highlights by chapter, bookmarks, then the notebook. */
export function bookToMarkdown(input: BookMarkdownInput): string {
  const labels = { ...DEFAULT_HIGHLIGHT_LABELS, ...input.labels } as Record<string, string>;
  const out: string[] = [
    "---",
    `title: ${yaml(input.title)}`,
    ...(input.author ? [`author: ${yaml(input.author)}`] : []),
    `exported_at: ${yaml(input.exportedAt)}`,
    "---",
    "",
    `# ${plain(input.title)}`,
    "",
  ];

  const highlights = input.annotations.filter((a) => a.kind !== "bookmark");
  const bookmarks = input.annotations.filter((a) => a.kind === "bookmark");
  const byPage = [...highlights].sort(
    (a, b) => a.pageStart - b.pageStart || (a.top ?? 0) - (b.top ?? 0),
  );
  out.push("## Highlights", "");
  if (byPage.length === 0) out.push("_No highlights._", "");
  for (const group of groupByChapter(byPage, input.outline)) {
    if (group.title) out.push(`### ${plain(group.title)}`, "");
    for (const a of group.items) out.push(annotationBlock(a, input, labels), "");
  }

  if (bookmarks.length) {
    out.push("## Bookmarks", "");
    for (const b of [...bookmarks].sort((x, y) => x.pageStart - y.pageStart)) {
      const note = b.comment ? ` · ${plain(b.comment.replace(/\s+/g, " "))}` : "";
      out.push(
        `- p. ${b.pageStart + 1} · [Open in Margin](${deepLink(input.origin, input.documentId, b.id)})${note}`,
      );
    }
    out.push("");
  }

  const notebook = input.notebook
    ? notebookToMarkdown(input.notebook, {
        origin: input.origin,
        documentId: input.documentId,
        annotations: input.annotations,
      })
    : "";
  if (notebook) out.push("## Notebook", "", notebook, "");
  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

/** A safe file name stem for a book. */
export function fileStem(title: string): string {
  const stem = title
    .normalize("NFKD")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  return stem || "book";
}
