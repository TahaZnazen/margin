"use client";

import { useEffect, useState } from "react";
import { services } from "@/lib/documents/services";
import type { Shelf, ShelfLink } from "./shelves-repo";

/** Shelves and their book links from the local database, live (null until the first read). */
export function useShelves(): { shelves: Shelf[]; links: ShelfLink[] } | null {
  const [data, setData] = useState<{ shelves: Shelf[]; links: ShelfLink[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const repo = services().shelves;
    const load = () =>
      Promise.all([repo.list(), repo.links()])
        .then(([shelves, links]) => !cancelled && setData({ shelves, links }))
        .catch((error) => console.error("Could not read shelves", error));
    void load();
    const stop = repo.subscribe(() => void load());
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  return data;
}
