"use client";

import { Button } from "@margin/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@margin/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@margin/ui/components/dropdown-menu";
import { Input } from "@margin/ui/components/input";
import { cn } from "@margin/ui/lib/utils";
import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ALL_BOOKS, MAX_SHELF_NAME } from "@/lib/shelves/logic";
import type { Shelf } from "@/lib/shelves/shelves-repo";

const chip =
  "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** "All books" plus one chip per shelf (with its count) and "New shelf". Scrolls sideways on a phone. */
export function ShelfBar({
  shelves,
  counts,
  total,
  selected,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  shelves: Shelf[];
  counts: Map<string, number>;
  total: number;
  selected: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (shelf: Shelf) => void;
  onDelete: (shelf: Shelf) => void;
}) {
  const pill = (active: boolean) =>
    cn(chip, active ? "border-primary bg-primary text-primary-foreground" : "bg-background");
  return (
    <nav aria-label="Shelves" className="-mx-1 overflow-x-auto px-1 pb-1" data-testid="shelf-bar">
      <ul className="m-0 flex list-none items-center gap-2 p-0">
        <li>
          <button
            type="button"
            className={pill(selected === ALL_BOOKS)}
            aria-pressed={selected === ALL_BOOKS}
            data-testid="shelf-chip"
            data-shelf="all"
            onClick={() => onSelect(ALL_BOOKS)}
          >
            All books <span className="text-xs">{total}</span>
          </button>
        </li>
        {shelves.map((shelf) => {
          const active = selected === shelf.id;
          return (
            <li key={shelf.id} className="flex shrink-0 items-center">
              <button
                type="button"
                className={cn(pill(active), "rounded-r-none border-r-0 pr-2")}
                aria-pressed={active}
                data-testid="shelf-chip"
                data-shelf={shelf.id}
                onClick={() => onSelect(shelf.id)}
              >
                <span className="max-w-40 truncate">{shelf.name}</span>
                <span className="text-xs">{counts.get(shelf.id) ?? 0}</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(pill(active), "rounded-l-none px-1.5")}
                    aria-label={`Menu for shelf ${shelf.name}`}
                  >
                    <ChevronDownIcon className="size-3.5" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => onRename(shelf)}>Rename shelf</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onDelete(shelf)}>Delete shelf</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            className={cn(chip, "border-dashed bg-background text-muted-foreground")}
            data-testid="new-shelf"
            onClick={onNew}
          >
            <PlusIcon className="size-3.5" aria-hidden /> New shelf
          </button>
        </li>
      </ul>
    </nav>
  );
}

/** Asks for a shelf name (new shelf or rename). `initial` null = closed. */
export function ShelfNameDialog({
  open,
  title,
  initial,
  submitLabel,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initial: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (name: string) => void | Promise<void>;
}) {
  const [name, setName] = useState(initial);
  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void Promise.resolve(onSubmit(name)).then(onClose);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Shelves group books. Books stay in your library.</DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Shelf name"
            value={name}
            maxLength={MAX_SHELF_NAME}
            placeholder="Pharmacology"
            onChange={(e) => setName(e.target.value)}
          />
          <DialogFooter>
            <Button type="submit" disabled={!name.trim()}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Checkboxes for the shelves one book is on, and a field to make a new shelf with it. */
export function BookShelvesDialog({
  title,
  shelves,
  memberOf,
  onToggle,
  onCreate,
  onClose,
}: {
  title: string | null;
  shelves: Shelf[];
  memberOf: Set<string>;
  onToggle: (shelf: Shelf, member: boolean) => void;
  onCreate: (name: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (title !== null) setName("");
  }, [title]);
  // The box ticks at once; the database write follows, and its result replaces this copy.
  const memberKey = [...memberOf].sort().join(",");
  const [shown, setShown] = useState(memberOf);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `memberKey` stands for the set's contents.
  useEffect(() => setShown(new Set(memberOf)), [memberKey, title]);
  return (
    <Dialog open={title !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="book-shelves-dialog">
        <DialogHeader>
          <DialogTitle>Shelves</DialogTitle>
          <DialogDescription className="truncate">{title}</DialogDescription>
        </DialogHeader>
        {shelves.length > 0 ? (
          <ul className="m-0 max-h-60 list-none space-y-1 overflow-y-auto p-0">
            {shelves.map((s) => (
              <li key={s.id}>
                <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-1 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={shown.has(s.id)}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setShown((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(s.id);
                        else next.delete(s.id);
                        return next;
                      });
                      onToggle(s, on);
                    }}
                  />
                  <span className="truncate">{s.name}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No shelves yet. Make the first one below.</p>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void Promise.resolve(onCreate(name)).then(() => setName(""));
          }}
        >
          <Input
            aria-label="New shelf name"
            value={name}
            maxLength={MAX_SHELF_NAME}
            placeholder="New shelf…"
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" variant="secondary" disabled={!name.trim()}>
            Add
          </Button>
        </form>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
