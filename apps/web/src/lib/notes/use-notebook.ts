"use client";

import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { services } from "@/lib/documents/services";
import { uuidv7 } from "@/lib/uuid";
import {
  appendQuote,
  asDoc,
  EMPTY_DOC,
  type JsonNode,
  plainTextOf,
  type QuoteAttrs,
  quoteIdsOf,
  quoteNode,
  rewriteQuoteIds,
} from "./doc";
import type { Note, NotesRepo } from "./notes-repo";

export const AUTOSAVE_MS = 500;

/**
 * Autosaves one note: edits apply in the editor at once and reach the repo 500 ms after the last
 * keystroke (and on pagehide / unmount). `existing` is the loaded row, if any; the row is created
 * on the first save.
 */
export function useNoteSaver(
  repo: NotesRepo,
  make: (existing: Note | null) => Pick<Note, "id" | "documentId" | "title" | "createdAt">,
  existing: Note | null,
) {
  const noteRef = useRef<Note | null>(existing);
  noteRef.current = noteRef.current ?? existing;
  const docRef = useRef<JsonNode | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [inflight, setInflight] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [failing, setFailing] = useState(false);
  const makeRef = useRef(make);
  makeRef.current = make;

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const doc = docRef.current;
    if (!doc) return;
    docRef.current = null;
    setDirty(false);
    const base = makeRef.current(noteRef.current);
    const note: Note = {
      ...base,
      docJson: doc,
      plainText: plainTextOf(doc),
      updatedAt: new Date().toISOString(),
    };
    noteRef.current = note;
    setInflight((n) => n + 1);
    try {
      await repo.save(note);
      setFailing(false);
    } catch {
      setFailing(true);
      docRef.current ??= doc;
      setDirty(true);
      timer.current = setTimeout(() => void flush(), 3000);
    } finally {
      setInflight((n) => n - 1);
    }
  }, [repo]);

  const schedule = useCallback(
    (doc: JsonNode) => {
      docRef.current = doc;
      setDirty(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
    },
    [flush],
  );

  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void flush();
    };
  }, [flush]);

  /** Writes not yet confirmed: waiting for the debounce, or in flight. */
  const pending = inflight + (dirty ? 1 : 0);
  return { schedule, flush, pending, failing, noteRef };
}

/** The book's notebook: loaded once per reader, saved with {@link useNoteSaver}. */
export function useNotebook(documentId: string) {
  const repo = services().notes;
  const [doc, setDoc] = useState<JsonNode>(EMPTY_DOC);
  const [loaded, setLoaded] = useState(false);
  const [existing, setExisting] = useState<Note | null>(null);
  const editor = useRef<Editor | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  const saver = useNoteSaver(
    repo,
    (current) => {
      const now = new Date().toISOString();
      return {
        id: current?.id ?? uuidv7(),
        documentId,
        title: current?.title ?? null,
        createdAt: current?.createdAt ?? now,
      };
    },
    existing,
  );
  const { schedule, flush } = saver;

  useEffect(() => {
    let cancelled = false;
    repo
      .getForDocument(documentId)
      .then((note) => {
        if (cancelled) return;
        setExisting(note);
        if (note) setDoc(asDoc(note.docJson));
        setLoaded(true);
      })
      // A failed load leaves the notebook unloaded (read-only): saving over it would fork it.
      .catch((error) => console.error("Could not load the notebook", error));
    return () => {
      cancelled = true;
    };
  }, [repo, documentId]);

  const onChange = useCallback(
    (next: JsonNode) => {
      docRef.current = next;
      setDoc(next);
      schedule(next);
    },
    [schedule],
  );

  const setEditor = useCallback((e: Editor | null) => {
    editor.current = e;
  }, []);

  /** Adds a quote at the end; works with or without the Notebook tab open. */
  const addQuote = useCallback(
    (attrs: QuoteAttrs) => {
      const live = editor.current;
      if (live && !live.isDestroyed) {
        live
          .chain()
          .insertContentAt(live.state.doc.content.size, [quoteNode(attrs), { type: "paragraph" }])
          .run();
      } else {
        onChange(appendQuote(docRef.current, attrs));
      }
      void flush();
    },
    [onChange, flush],
  );

  /** Highlights were merged: quotes of the removed ones now point at the survivor. */
  const repoint = useCallback(
    (map: ReadonlyMap<string, string>) => {
      if (map.size === 0) return;
      const live = editor.current;
      if (live && !live.isDestroyed) {
        const { tr } = live.state;
        live.state.doc.descendants((node, pos) => {
          const to = node.type.name === "annotationQuote" ? map.get(node.attrs.annotationId) : null;
          if (to) tr.setNodeMarkup(pos, undefined, { ...node.attrs, annotationId: to });
        });
        if (tr.docChanged) live.view.dispatch(tr);
      } else {
        const next = rewriteQuoteIds(docRef.current, map);
        if (next !== docRef.current) onChange(next);
      }
    },
    [onChange],
  );

  const referenced = useMemo(() => quoteIdsOf(doc), [doc]);

  return {
    doc,
    loaded,
    onChange,
    setEditor,
    addQuote,
    repoint,
    referenced,
    pending: saver.pending,
    failing: saver.failing,
  };
}
