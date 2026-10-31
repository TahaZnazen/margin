"use client";

import { toast } from "@margin/ui/components/sonner";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { services } from "@/lib/documents/services";
import {
  type ChapterChange,
  type ChapterNode,
  type ChapterSource,
  countedChapters,
  invert,
  toggleChanges,
} from "./progress";

export interface ChapterProgressApi {
  isDone: (key: string) => boolean;
  /** Keys done by the opt-in auto-mark setting (shown with a lighter check). */
  isAuto: (key: string) => boolean;
  /** Ticks or clears a chapter (and what follows from it) as one step, with an Undo toast. */
  toggle: (key: string) => void;
  /** Marks a chapter done if it is not. Returns whether anything changed. */
  markDone: (key: string, source?: ChapterSource) => boolean;
  doneCount: number;
  /** False until the first read of the local database has finished. */
  ready: boolean;
}

/**
 * The marks of one book, live from the local database. Writes show at once (optimistic) and go
 * to local SQLite; nothing waits on the network.
 */
export function useChapterProgress(
  documentId: string,
  nodes: readonly ChapterNode[],
  onAllDone?: () => void,
): ChapterProgressApi {
  const [done, setDone] = useState<ReadonlyMap<string, ChapterSource>>(new Map());
  const [ready, setReady] = useState(false);
  const doneRef = useRef(done);
  doneRef.current = done;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const allDoneRef = useRef(onAllDone);
  allDoneRef.current = onAllDone;

  useEffect(() => {
    let cancelled = false;
    let latest = 0;
    const repo = services().chapterProgress;
    const load = () => {
      const mine = ++latest;
      return repo
        .doneForDocument(documentId)
        .then((rows) => {
          if (cancelled || mine !== latest) return;
          const next = new Map(rows.map((r) => [r.key, r.source] as const));
          doneRef.current = next;
          setDone(next);
          setReady(true);
        })
        .catch((error) => console.error("Could not read chapter marks", error));
    };
    void load();
    const stop = repo.subscribe(() => void load());
    return () => {
      cancelled = true;
      stop();
    };
  }, [documentId]);

  const write = useCallback(
    (changes: readonly ChapterChange[], source: ChapterSource) => {
      if (changes.length === 0) return;
      const next = new Map(doneRef.current);
      for (const c of changes) {
        if (c.done) next.set(c.key, source);
        else next.delete(c.key);
      }
      doneRef.current = next;
      setDone(next);
      void services()
        .chapterProgress.apply(documentId, changes, source)
        .catch((error) => {
          console.error("Could not save chapter marks", error);
          toast.error("Could not save that chapter mark.");
        });
      // Every counted chapter done: the book is finished (the user can still change it).
      const tops = countedChapters(nodesRef.current);
      if (tops.length > 0 && tops.every((n) => next.has(n.key))) allDoneRef.current?.();
    },
    [documentId],
  );

  const toggle = useCallback(
    (key: string) => {
      const changes = toggleChanges(nodesRef.current, (k) => doneRef.current.has(k), key);
      if (changes.length === 0) return;
      write(changes, "manual");
      const marked = changes[0]?.done ?? true;
      const title = nodesRef.current.find((n) => n.key === key)?.title ?? "chapter";
      const extra = changes.length - 1;
      toast(
        `${marked ? "Marked" : "Cleared"} "${title}"${extra > 0 ? ` and ${extra} more` : ""}${marked ? " as done" : ""}`,
        {
          id: "chapter-mark",
          action: { label: "Undo", onClick: () => write(invert(changes), "manual") },
        },
      );
    },
    [write],
  );

  const markDone = useCallback(
    (key: string, source: ChapterSource = "manual") => {
      const changes = toggleChanges(nodesRef.current, (k) => doneRef.current.has(k), key, true);
      if (changes.length === 0) return false;
      write(changes, source);
      return true;
    },
    [write],
  );

  return useMemo(
    () => ({
      isDone: (key) => done.has(key),
      isAuto: (key) => done.get(key) === "auto",
      toggle,
      markDone,
      doneCount: done.size,
      ready,
    }),
    [done, ready, toggle, markDone],
  );
}
