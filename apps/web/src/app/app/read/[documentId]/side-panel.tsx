"use client";

import { HIGHLIGHT_COLORS, type HighlightColor } from "@margin/annotation-model";
import type { OutlineItem } from "@margin/reader";
import { Input } from "@margin/ui/components/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@margin/ui/components/tabs";
import { cn } from "@margin/ui/lib/utils";
import { BookMarkedIcon, NotebookPenIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { DRAG_TYPE, NoteEditor, type QuoteHost } from "@/components/notes/note-editor";
import type { Annotation } from "@/lib/annotations/annotations-repo";
import { groupByChapter } from "@/lib/annotations/chapters";
import type { useNotebook } from "@/lib/notes/use-notebook";

type Notebook = ReturnType<typeof useNotebook>;

export function filterItems(
  items: readonly Annotation[],
  colors: ReadonlySet<HighlightColor>,
  query: string,
): Annotation[] {
  const q = query.trim().toLowerCase();
  return items.filter((a) => {
    if (colors.size > 0 && !(a.color && colors.has(a.color))) return false;
    if (!q) return true;
    return `${a.quoteText ?? ""}\n${a.comment ?? ""}`.toLowerCase().includes(q);
  });
}

function Item({
  a,
  labels,
  inNotebook,
  canAdd,
  onJump,
  onHover,
  onAdd,
  onDelete,
}: {
  a: Annotation;
  labels: Record<HighlightColor, string>;
  inNotebook: boolean;
  canAdd: boolean;
  onJump(id: string): void;
  onHover(id: string | null): void;
  onAdd(id: string): void;
  onDelete(id: string): void;
}) {
  return (
    // A card with its own buttons cannot have the button role (axe: nested-interactive).
    // biome-ignore lint/a11y/useSemanticElements: a focusable card, not a <fieldset>
    <div
      role="group"
      aria-label={a.quoteText ? `Highlight: ${a.quoteText.slice(0, 80)}` : "Highlight"}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the card is a keyboard target (Enter jumps)
      tabIndex={0}
      draggable
      data-testid="annot-item"
      data-annotation-id={a.id}
      data-color={a.color ?? undefined}
      className="mr-annot-item group cursor-pointer rounded-md border bg-card p-2 text-left text-sm hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onJump(a.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onJump(a.id);
      }}
      onMouseEnter={() => onHover(a.id)}
      onMouseLeave={() => onHover(null)}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, a.id);
        e.dataTransfer.setData("text/plain", a.quoteText ?? "");
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <span
          className="size-2.5 rounded-full"
          style={{ background: a.color ? `var(--hl-${a.color}-chip)` : "var(--border)" }}
          title={a.color ? labels[a.color] : undefined}
        />
        <span>{a.color ? labels[a.color] : "Area"}</span>
        <span className="ml-auto tabular-nums">p. {a.pageStart + 1}</span>
      </div>
      {a.quoteText ? (
        <p className="mt-1 line-clamp-4 font-serif" data-testid="annot-quote">
          {a.quoteText}
        </p>
      ) : null}
      {a.comment ? (
        <p className="mt-1 line-clamp-3 text-muted-foreground" data-testid="annot-comment">
          {a.comment}
        </p>
      ) : null}
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        {inNotebook ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5"
            data-testid="in-notebook"
          >
            <NotebookPenIcon className="size-3" /> In notebook
          </span>
        ) : null}
        <button
          type="button"
          data-testid="add-to-notebook"
          disabled={!canAdd}
          className="ml-auto rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:opacity-50"
          onClick={(e) => {
            e.stopPropagation();
            onAdd(a.id);
          }}
        >
          Add to notebook
        </button>
        <button
          type="button"
          data-testid="annot-delete"
          title="Delete highlight"
          aria-label="Delete highlight"
          className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(a.id);
          }}
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export interface SidePanelProps {
  items: readonly Annotation[];
  outline: OutlineItem[];
  labels: Record<HighlightColor, string>;
  notebook: Notebook;
  host: QuoteHost;
  tab: string;
  onTab(tab: string): void;
  onJump(id: string): void;
  onHover(id: string | null): void;
  onAdd(id: string): void;
  onDelete(id: string): void;
}

export function SidePanel(props: SidePanelProps) {
  const { items, outline, labels, notebook, host, tab, onTab, onJump, onHover, onAdd, onDelete } =
    props;
  const [colors, setColors] = useState<ReadonlySet<HighlightColor>>(new Set());
  const [query, setQuery] = useState("");

  const shown = useMemo(() => items.filter((i) => i.kind !== "bookmark"), [items]);
  const counts = useMemo(() => {
    const out = new Map<HighlightColor, number>();
    for (const a of shown) if (a.color) out.set(a.color, (out.get(a.color) ?? 0) + 1);
    return out;
  }, [shown]);
  const filtered = useMemo(() => filterItems(shown, colors, query), [shown, colors, query]);
  const groups = useMemo(() => groupByChapter(filtered, outline), [filtered, outline]);

  const toggle = (c: HighlightColor) =>
    setColors((prev) => {
      const next = new Set(prev);
      if (!next.delete(c)) next.add(c);
      return next;
    });

  return (
    <Tabs
      value={tab}
      onValueChange={onTab}
      className="h-full min-h-0 gap-0"
      data-testid="side-panel"
    >
      <TabsList variant="line" className="w-full shrink-0 justify-start border-b px-2">
        <TabsTrigger value="annotations" data-testid="tab-annotations">
          Annotations
        </TabsTrigger>
        <TabsTrigger value="notebook" data-testid="tab-notebook">
          Notebook
        </TabsTrigger>
      </TabsList>

      <TabsContent value="annotations" className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-2 border-b p-2">
          <Input
            type="search"
            placeholder="Search quotes and comments"
            aria-label="Search annotations"
            data-testid="annot-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <fieldset
            className="m-0 flex min-w-0 flex-wrap gap-1 border-0 p-0"
            aria-label="Filter by color"
          >
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                data-testid={`filter-${c}`}
                aria-pressed={colors.has(c)}
                title={labels[c]}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                  colors.has(c) && "bg-accent ring-1 ring-foreground/30",
                )}
                onClick={() => toggle(c)}
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: `var(--hl-${c}-chip)` }}
                />
                <span data-testid={`count-${c}`}>{counts.get(c) ?? 0}</span>
              </button>
            ))}
          </fieldset>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2" data-testid="annot-list">
          {groups.length === 0 ? (
            <p className="p-2 text-muted-foreground text-sm" data-testid="annot-empty">
              {shown.length === 0
                ? "Highlights you make will be listed here."
                : "No highlights match."}
            </p>
          ) : null}
          {groups.map((g) => (
            <section key={g.title ?? "all"} data-testid="annot-group">
              {g.title ? (
                <h2 className="sticky top-0 z-10 mb-1 flex items-center gap-1 bg-background py-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  <BookMarkedIcon className="size-3" /> {g.title}
                </h2>
              ) : null}
              <div className="space-y-1.5">
                {g.items.map((a) => (
                  <Item
                    key={a.id}
                    a={a}
                    labels={labels}
                    inNotebook={notebook.referenced.has(a.id)}
                    canAdd={notebook.loaded}
                    onJump={onJump}
                    onHover={onHover}
                    onAdd={onAdd}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="notebook" className="flex min-h-0 flex-1 flex-col">
        {notebook.loaded ? (
          <NoteEditor
            initial={notebook.doc}
            onChange={notebook.onChange}
            onEditor={notebook.setEditor}
            host={host}
            className="h-full"
          />
        ) : (
          <p className="p-3 text-muted-foreground text-sm">Opening your notebook…</p>
        )}
      </TabsContent>
    </Tabs>
  );
}
