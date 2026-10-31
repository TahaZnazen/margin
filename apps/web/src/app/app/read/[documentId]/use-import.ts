"use client";

import { AnnotationShape, type AnnotationTarget } from "@margin/annotation-model";
import { canvasMeasure, type ReaderDocument } from "@margin/reader";
import { toast } from "@margin/ui/components/sonner";
import { useEffect, useRef } from "react";
import type { Annotation } from "@/lib/annotations/annotations-repo";
import type { AnnotationStore } from "@/lib/annotations/store";
import type { Book } from "@/lib/documents/documents-repo";
import { services } from "@/lib/documents/services";
import { type ImportedItem, importFromPdf } from "@/lib/pdf-io/import";
import { uuidv7 } from "@/lib/uuid";

/** An imported item as an annotation row, validated; null when it does not fit the model. */
export function toAnnotation(
  item: ImportedItem,
  documentId: string,
  fingerprint: string,
  now: string,
): Annotation | null {
  const segments = [{ page: item.page, rects: item.rects }];
  const base = { id: uuidv7(), documentId, comment: item.comment, createdAt: now, updatedAt: now };
  if (item.kind === "highlight") {
    const target = { fingerprint, segments, quote: item.quote };
    const parsed = AnnotationShape.safeParse({
      kind: "highlight",
      color: item.color,
      target,
      quote_text: item.quote.exact,
      page_start: item.page,
    });
    if (!parsed.success) return null;
    return {
      ...base,
      kind: "highlight",
      color: item.color,
      target: parsed.data.target as AnnotationTarget,
      pageStart: item.page,
      quoteText: item.quote.exact,
      tags: item.tags,
      anchorStatus: "anchored",
    };
  }
  const target = { fingerprint, segments };
  const parsed = AnnotationShape.safeParse({
    kind: "bookmark",
    target,
    quote_text: null,
    page_start: item.page,
  });
  if (!parsed.success) return null;
  return {
    ...base,
    kind: "bookmark",
    color: null,
    target: parsed.data.target as AnnotationTarget,
    pageStart: item.page,
    quoteText: null,
    tags: [],
    anchorStatus: "anchored",
  };
}

/**
 * Brings the PDF's own highlights and sticky notes in, once per book: the first open claims
 * `documents.annotations_imported_at` atomically, so two tabs (or devices) cannot both import.
 * Runs after the book is readable and the annotation store has loaded; reading never waits on it.
 */
export function useImportExisting(args: {
  book: Book;
  bytes: ArrayBuffer;
  doc: ReaderDocument | null;
  store: AnnotationStore;
  loaded: boolean;
}) {
  const { book, bytes, doc, store, loaded } = args;
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !doc || !loaded || book.annotationsImportedAt) return;
    started.current = true;
    (async () => {
      if (!(await services().documents.claimImport(book.id))) return;
      try {
        const items = await importFromPdf(bytes, (page) => doc.pageText(page), canvasMeasure);
        const now = new Date().toISOString();
        const list = items
          .map((item) => toAnnotation(item, book.id, `sha256:${book.sha256}`, now))
          .filter((a): a is Annotation => a !== null);
        if (list.length === 0) return;
        store.createMany(list);
        const highlights = list.filter((a) => a.kind === "highlight").length;
        const notes = list.length - highlights;
        toast.success(
          `Imported ${highlights} highlight${highlights === 1 ? "" : "s"}${
            notes ? ` and ${notes} note${notes === 1 ? "" : "s"}` : ""
          }`,
        );
      } catch (error) {
        console.warn("Could not import the PDF's own annotations", error);
        // Give the claim back so the next open tries again instead of losing the highlights.
        await services()
          .documents.releaseImport(book.id)
          .catch(() => undefined);
        toast.error("Couldn't import the highlights already in this PDF. We'll retry next time.");
      }
    })().catch((error) => console.warn("Import check failed", error));
  }, [book, bytes, doc, store, loaded]);
}
