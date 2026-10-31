"use client";

import type { FindState, PdfViewerHandle } from "@margin/reader";
import { Button } from "@margin/ui/components/button";
import { Input } from "@margin/ui/components/input";
import { cn } from "@margin/ui/lib/utils";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { findCountLabel } from "@/lib/reader/find";

const TYPE_DEBOUNCE_MS = 200;

/**
 * Find in this book. Searches as you type, Enter / Shift+Enter step through the hits, Esc closes
 * and clears them. Ctrl/Cmd+F while the box has focus is left to the browser's own find.
 */
export function FindBar({
  viewer,
  find,
  seed,
  onClose,
  className,
}: {
  viewer: RefObject<PdfViewerHandle | null>;
  find: FindState;
  /** A new `nonce` (re)fills the box with `text` and searches at once; `nonce` 0 is a plain open. */
  seed: { text: string; nonce: number };
  onClose: () => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(seed.text);
  const lastQuery = useRef(find.query);
  lastQuery.current = find.query;

  // Focus on open and on every Ctrl/Cmd+F / palette request. A seeded query is searched at once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new seed re-runs this
  useEffect(() => {
    if (seed.text) {
      setValue(seed.text);
      viewer.current?.find(seed.text);
    }
    input.current?.focus();
    input.current?.select();
  }, [seed.nonce]);

  // Search as you type; a newer query aborts the older search inside the viewer.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (value !== lastQuery.current) viewer.current?.find(value);
    }, TYPE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, viewer]);

  const close = () => {
    viewer.current?.clearFind();
    onClose();
    viewer.current?.focus();
  };
  const step = (dir: 1 | -1) => {
    if (value.trim() && find.query === value && find.total > 0) {
      if (dir === 1) viewer.current?.findNext();
      else viewer.current?.findPrev();
    } else viewer.current?.find(value);
  };
  const count = findCountLabel(find, value);

  return (
    <search
      className={cn(
        "flex items-center gap-1 rounded-lg border bg-card p-1.5 text-card-foreground shadow-md",
        className,
      )}
      data-testid="find-bar"
    >
      <Input
        ref={input}
        type="search"
        value={value}
        placeholder="Find in this book"
        aria-label="Find in this book"
        data-testid="find-input"
        autoComplete="off"
        spellCheck={false}
        className="h-8 min-w-0 flex-1 sm:w-56 sm:flex-none"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          } else if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          }
        }}
      />
      <output
        className="min-w-16 shrink-0 text-center text-muted-foreground text-xs tabular-nums"
        data-testid="find-count"
        data-searching={find.searching || (value.trim() !== "" && find.query !== value)}
        aria-live="polite"
      >
        {count}
      </output>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        disabled={find.total === 0}
        onClick={() => step(-1)}
      >
        <ChevronUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label="Next match"
        title="Next match (Enter)"
        disabled={find.total === 0}
        onClick={() => step(1)}
      >
        <ChevronDownIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label="Close find"
        title="Close (Esc)"
        onClick={close}
      >
        <XIcon />
      </Button>
    </search>
  );
}
