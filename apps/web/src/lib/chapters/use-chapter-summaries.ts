"use client";

import { useEffect, useState } from "react";
import { services } from "@/lib/documents/services";
import type { ChapterSummary } from "./progress";

/** Chapters done per book from the local database, live (null until the first read). */
export function useChapterSummaries(): Map<string, ChapterSummary> | null {
  const [data, setData] = useState<Map<string, ChapterSummary> | null>(null);
  useEffect(() => {
    let cancelled = false;
    let latest = 0;
    const repo = services().chapterProgress;
    const load = () => {
      const mine = ++latest;
      return repo
        .summaries()
        .then((map) => !cancelled && mine === latest && setData(map))
        .catch((error) => console.error("Could not read chapter progress", error));
    };
    void load();
    const stop = repo.subscribe(() => void load());
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  return data;
}
