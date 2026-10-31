import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { BACKUP_TABLES, type BackupRows, buildBackupZip } from "./backup";
import { bookToMarkdown, type MarkdownAnnotation, notebookToMarkdown } from "./markdown";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const DOC = "99999999-9999-4999-8999-999999999999";

const annotations: MarkdownAnnotation[] = [
  {
    id: ID1,
    kind: "highlight",
    color: "key",
    quoteText: "First line\nsecond <b>line</b>",
    comment: "My thought",
    tags: ["renal", "exam-2"],
    pageStart: 2,
  },
  {
    id: ID2,
    kind: "highlight",
    color: "memorize",
    quoteText: "Later",
    comment: null,
    pageStart: 40,
  },
  { id: "b", kind: "bookmark", color: null, quoteText: null, comment: "Check this", pageStart: 5 },
];

const notebook = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Ideas" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
        { type: "text", text: " and " },
        { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://e.org" } }] },
      ],
    },
    {
      type: "annotationQuote",
      attrs: { annotationId: ID1, quoteSnapshot: "old snapshot", color: "key", page: 2 },
    },
    {
      type: "annotationQuote",
      attrs: { annotationId: "gone", quoteSnapshot: "Deleted text", color: "key", page: 9 },
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }],
        },
      ],
    },
  ],
};

describe("Markdown export", () => {
  const md = bookToMarkdown({
    documentId: DOC,
    title: 'Deep "Work"',
    author: "C. Newport",
    exportedAt: "2026-10-28T10:00:00.000Z",
    origin: "https://margin.test/",
    outline: [
      { title: "Intro", page: 0, children: [] },
      { title: "Part Two", page: 30, children: [] },
    ],
    annotations,
    notebook,
  });

  it("has YAML frontmatter with title, author and exported_at", () => {
    expect(md.startsWith('---\ntitle: "Deep \\"Work\\""\nauthor: "C. Newport"\n')).toBe(true);
    expect(md).toContain('exported_at: "2026-10-28T10:00:00.000Z"');
  });

  it("groups highlights by chapter with label, page, comment and a deep link", () => {
    expect(md.indexOf("### Intro")).toBeLessThan(md.indexOf("### Part Two"));
    expect(md).toContain(
      `**Key idea** · p. 3 · [Open in Margin](https://margin.test/app/read/${DOC}#a=${ID1})`,
    );
    expect(md).toContain("My thought");
    expect(md).toContain("**Memorize** · p. 41");
    expect(md).toContain("- **Check this** · p. 6 ·");
  });

  it("lists the tags of a highlight", () => {
    expect(md).toContain("Tags: #renal #exam-2");
    expect(md.match(/Tags:/g)).toHaveLength(1);
  });

  it("turns quote nodes into linked blockquotes and degrades deleted ones", () => {
    expect(md).toContain("## Notebook");
    expect(md).toContain("### Ideas");
    expect(md).toContain("**bold** and [link](https://e.org)");
    expect(md).toContain("- [x] done");
    expect(md).toContain(
      `> First line\n> second \\<b>line\\</b>\n>\n> p. 3 · [Open in Margin](https://margin.test/app/read/${DOC}#a=${ID1})`,
    );
    expect(md).toContain("> Deleted text\n>\n> p. 10 · highlight deleted");
  });

  it("lists a named bookmark by its name, with its page and link", () => {
    expect(md).toContain(
      "- **Check this** · p. 6 · [Open in Margin](https://margin.test/app/read/" + DOC + "#a=b)",
    );
  });
  it("lists an unnamed bookmark by page only", () => {
    const plain = bookToMarkdown({
      documentId: DOC,
      title: "T",
      author: null,
      exportedAt: "2026-10-28T10:00:00.000Z",
      origin: "https://margin.test",
      outline: [],
      annotations: [
        { id: "z", kind: "bookmark", color: null, quoteText: null, comment: null, pageStart: 2 },
      ],
      notebook: null,
    });
    expect(plain).toContain("- p. 3 · [Open in Margin](");
  });
  it("never emits raw HTML", () => {
    expect(md).not.toMatch(/(^|[^\\])<[a-z/]/i);
  });

  it("converts a notebook on its own", () => {
    expect(
      notebookToMarkdown(notebook, { origin: "https://x", documentId: DOC, annotations }),
    ).toContain("### Ideas");
  });
});

describe("Export everything zip", () => {
  it("holds every table's rows, every book's Markdown and optionally the PDFs", () => {
    const tables = Object.fromEntries(
      BACKUP_TABLES.map((t, i) => [
        t,
        Array.from({ length: i + 1 }, (_, k) => ({ id: `${t}-${k}` })),
      ]),
    ) as unknown as BackupRows;
    const pdf = new Uint8Array([37, 80, 68, 70]);
    const zip = unzipSync(
      buildBackupZip({
        exportedAt: "2026-10-28T10:00:00.000Z",
        tables,
        books: [
          { id: DOC, title: "Deep Work", markdown: "# Deep Work\n", pdf },
          { id: ID1, title: "No pdf", markdown: "# x\n" },
        ],
      }),
    );
    const dump = JSON.parse(strFromU8(zip["margin-data.json"] as Uint8Array));
    expect(dump.format).toBe("margin-backup");
    expect(dump.version).toBe(1);
    for (const [i, t] of BACKUP_TABLES.entries()) expect(dump.tables[t]).toHaveLength(i + 1);
    expect(Object.keys(zip).sort()).toEqual([
      "books/Deep-Work-99999999.md",
      "books/No-pdf-11111111.md",
      "margin-data.json",
      "pdfs/Deep-Work-99999999.pdf",
    ]);
    expect(zip["pdfs/Deep-Work-99999999.pdf"]).toEqual(pdf);
  });
});
