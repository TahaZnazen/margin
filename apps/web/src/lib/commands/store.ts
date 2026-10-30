"use client";

import { useEffect, useSyncExternalStore } from "react";

/** What the open book lends to the command palette. Registered by the reader while it is mounted. */
export interface ReaderCommands {
  title: string;
  pageCount: number;
  /** 0-based. */
  goToPage: (page: number) => void;
  chapters: { title: string; page: number; offsetPt: number; depth: number }[];
  goToChapter: (page: number, offsetPt: number) => void;
  annotations: { id: string; kind: string; quote: string; comment: string; page: number }[];
  jumpToAnnotation: (id: string) => void;
  toggleSidebar: () => void;
  togglePanel: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitWidth: () => void;
  fitPage: () => void;
}

interface PaletteState {
  open: boolean;
  query: string;
  help: boolean;
  reader: ReaderCommands | null;
}

let state: PaletteState = { open: false, query: "", help: false, reader: null };
const listeners = new Set<() => void>();

function set(patch: Partial<PaletteState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export const palette = {
  open: (query = "") => set({ open: true, query, help: false }),
  close: () => set({ open: false }),
  setQuery: (query: string) => set({ query }),
  toggle: () => set({ open: !state.open, query: "", help: false }),
  openHelp: () => set({ help: true, open: false }),
  closeHelp: () => set({ help: false }),
};

export function usePalette(): PaletteState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/** Lends the open book's actions to the palette until the reader unmounts. */
export function useRegisterReaderCommands(commands: ReaderCommands) {
  useEffect(() => {
    set({ reader: commands });
  }, [commands]);
  useEffect(
    () => () => {
      set({ reader: null });
    },
    [],
  );
}
