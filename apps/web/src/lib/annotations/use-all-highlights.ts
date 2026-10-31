"use client";

import { DEFAULT_HIGHLIGHT_LABELS, type HighlightColor } from "@margin/annotation-model";
import { useEffect, useState } from "react";
import { services } from "@/lib/documents/services";
import type { HighlightEntry } from "./annotations-repo";

/** Every highlight of every book from the local database, live (null until the first read). */
export function useAllHighlights(enabled = true): HighlightEntry[] | null {
  const [entries, setEntries] = useState<HighlightEntry[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const repo = services().allHighlights;
    const load = () =>
      repo
        .listAll()
        .then((list) => !cancelled && setEntries(list))
        .catch((error) => console.error("Could not read highlights", error));
    void load();
    const stop = repo.subscribeAll(() => void load());
    return () => {
      cancelled = true;
      stop();
    };
  }, [enabled]);
  return entries;
}

/** Color labels, with the user's renames applied. */
export function useHighlightLabels(): Record<HighlightColor, string> {
  const [labels, setLabels] = useState<Record<HighlightColor, string>>({
    ...DEFAULT_HIGHLIGHT_LABELS,
  });
  useEffect(() => {
    let cancelled = false;
    services()
      .settings.get()
      .then((s) => !cancelled && setLabels({ ...DEFAULT_HIGHLIGHT_LABELS, ...s.highlightLabels }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return labels;
}
