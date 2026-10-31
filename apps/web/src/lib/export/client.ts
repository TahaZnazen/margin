"use client";

import type { HighlightColor } from "@margin/annotation-model";
import type { OutlineItem } from "@margin/reader";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Annotation } from "@/lib/annotations/annotations-repo";
import { parseTags } from "@/lib/annotations/tags";
import { opfsRead } from "@/lib/documents/opfs";
import { services } from "@/lib/documents/services";
import { asDoc, type JsonNode } from "@/lib/notes/doc";
import { exportAnnotatedPdf } from "@/lib/pdf-io/export";
import { createClient } from "@/lib/supabase/client";
import { BACKUP_TABLES, type BackupBook, type BackupRows, buildBackupZip } from "./backup";
import { bookToMarkdown, fileStem, type MarkdownAnnotation } from "./markdown";

type Row = Record<string, unknown>;

export function saveBlob(filename: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** All of a user's live rows in a table (RLS scopes them), paged past the 1,000-row API limit. */
async function fetchAllRows(supabase: SupabaseClient, table: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .is("deleted_at", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) return rows;
  }
}

const markdownAnnotation = (a: Annotation): MarkdownAnnotation => ({
  id: a.id,
  kind: a.kind,
  color: a.color,
  quoteText: a.quoteText,
  comment: a.comment,
  tags: a.tags,
  pageStart: a.pageStart,
  top: a.target.segments[0].rects[0]?.[1],
});

const rowAnnotation = (r: Row): MarkdownAnnotation => ({
  id: String(r.id),
  kind: r.kind as MarkdownAnnotation["kind"],
  color: (r.color as HighlightColor | null) ?? null,
  quoteText: (r.quote_text as string | null) ?? null,
  comment: (r.comment as string | null) ?? null,
  tags: parseTags(r.tags),
  pageStart: Number(r.page_start),
  top: (r.target as { segments?: { rects?: number[][] }[] } | null)?.segments?.[0]?.rects?.[0]?.[1],
});

/** The PDF's bytes: this device's copy first, else a signed-URL download. */
export async function pdfBytes(
  documentId: string,
  storagePath: string | null,
): Promise<Uint8Array> {
  const local = await opfsRead(documentId);
  if (local) return new Uint8Array(await local.arrayBuffer());
  if (!storagePath) throw new Error("This book's file is not available on this device yet.");
  const res = await fetch(await services().storage.getReadUrl(storagePath));
  if (!res.ok) throw new Error("The download failed.");
  return new Uint8Array(await res.arrayBuffer());
}

export async function exportBookMarkdown(documentId: string, outline: OutlineItem[]) {
  const s = services();
  const supabase = createClient();
  const [book, items, notebook, settings] = await Promise.all([
    s.documents.get(documentId),
    s.annotations.list(documentId),
    s.notes.getForDocument(documentId),
    supabase
      .from("user_settings")
      .select("highlight_labels")
      .maybeSingle<{ highlight_labels: Partial<Record<HighlightColor, string>> | null }>(),
  ]);
  if (!book) throw new Error("This book is not in your library.");
  const markdown = bookToMarkdown({
    documentId,
    title: book.title,
    author: book.author,
    exportedAt: new Date().toISOString(),
    origin: window.location.origin,
    labels: settings.data?.highlight_labels ?? {},
    outline,
    annotations: items.map(markdownAnnotation),
    notebook: notebook ? asDoc(notebook.docJson) : null,
  });
  saveBlob(`${fileStem(book.title)}.md`, markdown, "text/markdown;charset=utf-8");
  return markdown;
}

export async function exportBookPdf(documentId: string, bytes?: ArrayBuffer | Uint8Array) {
  const s = services();
  const [book, items] = await Promise.all([
    s.documents.get(documentId),
    s.annotations.list(documentId),
  ]);
  if (!book) throw new Error("This book is not in your library.");
  const source = bytes ?? (await pdfBytes(documentId, book.storagePath));
  const out = await exportAnnotatedPdf(
    source,
    items.map((a) => ({
      id: a.id,
      kind: a.kind,
      color: a.color,
      comment: a.comment,
      tags: a.tags,
      updatedAt: a.updatedAt,
      segments: a.target.segments.map((seg) => ({ page: seg.page, rects: seg.rects })),
    })),
    "Margin",
    book.annotationsImportedAt !== null,
  );
  saveBlob(`${fileStem(book.title)}-annotated.pdf`, out as BlobPart, "application/pdf");
  return out;
}

export interface EverythingProgress {
  step: string;
  done: number;
  total: number;
}

/** Zip of every row, every book's Markdown, and optionally the PDFs. */
export async function exportEverything(
  includePdfs: boolean,
  onProgress: (p: EverythingProgress) => void = () => undefined,
): Promise<{ bytes: Uint8Array; counts: Record<string, number>; skippedPdfs: string[] }> {
  const supabase = createClient();
  const tables = {} as BackupRows;
  for (const [i, table] of BACKUP_TABLES.entries()) {
    onProgress({ step: `Reading ${table}`, done: i, total: BACKUP_TABLES.length });
    tables[table] = await fetchAllRows(supabase, table);
  }
  const labels = (tables.user_settings[0]?.highlight_labels ?? {}) as Partial<
    Record<HighlightColor, string>
  >;
  const exportedAt = new Date().toISOString();
  const books: BackupBook[] = [];
  const skippedPdfs: string[] = [];
  for (const [i, doc] of tables.documents.entries()) {
    const id = String(doc.id);
    onProgress({ step: `Packing ${String(doc.title)}`, done: i, total: tables.documents.length });
    const notebook = tables.notes.find((n) => n.document_id === id);
    const outline = Array.isArray(doc.outline) ? (doc.outline as OutlineItem[]) : [];
    let pdf: Uint8Array | undefined;
    if (includePdfs) {
      try {
        pdf = await pdfBytes(id, (doc.storage_path as string | null) ?? null);
      } catch (error) {
        console.warn("PDF left out of the export", id, error);
        skippedPdfs.push(String(doc.title));
      }
    }
    books.push({
      id,
      title: String(doc.title),
      markdown: bookToMarkdown({
        documentId: id,
        title: String(doc.title),
        author: (doc.author as string | null) ?? null,
        exportedAt,
        origin: window.location.origin,
        labels,
        outline,
        annotations: tables.annotations.filter((a) => a.document_id === id).map(rowAnnotation),
        notebook: notebook ? (asDoc(notebook.doc_json) as JsonNode) : null,
      }),
      pdf,
    });
  }
  const counts = Object.fromEntries(BACKUP_TABLES.map((t) => [t, tables[t].length]));
  return { bytes: buildBackupZip({ exportedAt, tables, books }), counts, skippedPdfs };
}
