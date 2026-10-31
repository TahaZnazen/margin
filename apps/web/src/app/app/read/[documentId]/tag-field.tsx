"use client";

import { XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_TAG_LENGTH,
  MAX_TAGS,
  normalizeTag,
  normalizeTags,
  tagCounts,
} from "@/lib/annotations/tags";
import { services } from "@/lib/documents/services";

export interface TagFieldProps {
  tags: readonly string[];
  /** Tags used by the highlights of this book (suggested first). */
  bookTags: readonly string[];
  /** Changes whenever the field should take focus (the # key). */
  focusNonce: number;
  onChange: (tags: string[]) => void;
}

/** Chips plus an input: Enter or comma adds, x removes, suggestions come from tags already used. */
export function TagField({ tags, bookTags, focusNonce, onChange }: TagFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [otherTags, setOtherTags] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (focusNonce > 0) input.current?.focus();
  }, [focusNonce]);

  // Tags of all books are read once, the first time the field is used.
  const loadOthers = () => {
    if (loaded.current) return;
    loaded.current = true;
    services()
      .allHighlights.listAll()
      .then((list) => setOtherTags(tagCounts(list.map((e) => e.tags)).map((t) => t.tag)))
      .catch(() => undefined);
  };

  const suggestions = useMemo(() => {
    const needle = normalizeTag(draft) ?? "";
    const seen = new Set(tags);
    const out: string[] = [];
    for (const t of [...bookTags, ...otherTags]) {
      if (seen.has(t) || !t.includes(needle)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= 5) break;
    }
    return out;
  }, [draft, tags, bookTags, otherTags]);

  const full = tags.length >= MAX_TAGS;

  const addMany = (raws: readonly string[]) => {
    setDraft("");
    const next = normalizeTags([...tags, ...raws]);
    if (next.length !== tags.length) onChange(next);
  };
  const add = (raw: string) => addMany([raw]);

  return (
    <div className="flex w-72 max-w-full flex-col gap-1" data-testid="tag-field">
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((t) => (
          <span
            key={t}
            data-testid="tag-chip"
            className="inline-flex items-center gap-0.5 rounded-full bg-accent py-0.5 pr-0.5 pl-2 text-xs"
          >
            #{t}
            <button
              type="button"
              aria-label={`Remove tag ${t}`}
              data-testid="tag-remove"
              className="inline-flex size-4 items-center justify-center rounded-full hover:bg-foreground/10 pointer-coarse:size-6"
              onClick={() => onChange(tags.filter((x) => x !== t))}
            >
              <XIcon className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          ref={input}
          value={draft}
          type="text"
          maxLength={MAX_TAG_LENGTH + 1}
          disabled={full}
          placeholder={full ? "10 tags is the limit" : tags.length ? "Add tag" : "Add a tag (#)"}
          aria-label="Add tag"
          autoComplete="off"
          data-testid="tag-input"
          className="h-6 min-w-20 flex-1 rounded-md bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onFocus={() => {
            loadOthers();
            setOpen(true);
          }}
          onBlur={() => {
            if (draft.trim()) add(draft);
            setOpen(false);
          }}
          onChange={(e) => {
            const value = e.target.value;
            if (value.includes(",")) {
              const parts = value.split(",");
              addMany(parts.slice(0, -1));
              setDraft(parts.at(-1) ?? "");
            } else setDraft(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && tags.length) {
              onChange(tags.slice(0, -1));
            } else if (e.key === "Escape") {
              setDraft("");
              input.current?.blur();
            }
          }}
        />
      </div>
      {open && suggestions.length > 0 ? (
        <fieldset
          aria-label="Tag suggestions"
          className="m-0 flex min-w-0 flex-wrap gap-1 border-0 p-0"
        >
          {suggestions.map((t) => (
            <button
              key={t}
              type="button"
              data-testid="tag-suggestion"
              aria-label={`Add tag ${t}`}
              className="rounded-full border px-2 py-0.5 text-muted-foreground text-xs hover:bg-accent/60 pointer-coarse:py-1.5"
              // Keep the input focused so blur does not close the list before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(t)}
            >
              #{t}
            </button>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}
