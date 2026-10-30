"use client";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@margin/ui/components/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@margin/ui/components/dialog";
import { Kbd } from "@margin/ui/components/kbd";
import { useTheme } from "@margin/ui/theme";
import {
  BookOpenIcon,
  HashIcon,
  HighlighterIcon,
  KeyboardIcon,
  ListIcon,
  NotebookPenIcon,
  PaletteIcon,
  PanelLeftIcon,
  PanelRightIcon,
  SettingsIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { palette, usePalette } from "@/lib/commands/store";
import type { Book } from "@/lib/documents/documents-repo";
import { services } from "@/lib/documents/services";

const THEME_ORDER = ["system", "light", "sepia", "dark"] as const;

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

/** Global keys: Ctrl/Cmd+K opens the palette, `?` the shortcut sheet. */
function useGlobalKeys() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        palette.toggle();
        return;
      }
      if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (isTyping(event.target)) return;
        event.preventDefault();
        palette.openHelp();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** "12", "page 12" or "p12" → 12. */
function pageFromQuery(query: string): number | null {
  const match = query.trim().match(/^(?:g|go to|page|p)?\s*(\d{1,5})$/i);
  return match?.[1] ? Number(match[1]) : null;
}

export function CommandPalette() {
  useGlobalKeys();
  const { open, query, help, reader } = usePalette();
  const router = useRouter();
  const { preference, setPreference } = useTheme();
  const [books, setBooks] = useState<Book[]>([]);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    services()
      .documents.list()
      .then((list) => !cancelled && setBooks(list))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  // A page number in the box makes "Go to page N" the highlighted choice, so Enter jumps.
  const page = pageFromQuery(query);
  useEffect(() => {
    if (page !== null) setSelected(`go to page ${page}`);
  }, [page]);

  const run = (action: () => void) => {
    palette.close();
    // After the dialog closed, so focus returns to the page before the action moves it.
    setTimeout(action, 0);
  };
  const nextTheme =
    THEME_ORDER[(THEME_ORDER.indexOf(preference as never) + 1) % THEME_ORDER.length];

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (o ? palette.open() : palette.close())}>
        <DialogContent
          showCloseButton={false}
          className="top-1/4 translate-y-0 overflow-hidden p-0 sm:max-w-lg"
          data-testid="command-palette"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Command palette</DialogTitle>
            <DialogDescription>Search books, pages, chapters, notes and actions.</DialogDescription>
          </DialogHeader>
          <Command loop value={selected} onValueChange={setSelected}>
            <CommandInput
              // Radix does not always move focus here (it stayed on the reader when opened by a key).
              ref={(el) => el?.focus()}
              value={query}
              onValueChange={palette.setQuery}
              placeholder={
                reader
                  ? "Type a command, page number, chapter or highlight…"
                  : "Type a command or a book title…"
              }
              aria-label="Command"
            />
            <CommandList className="max-h-80">
              <CommandEmpty>Nothing matches.</CommandEmpty>
              {reader && page !== null ? (
                <CommandGroup heading="Go to" forceMount>
                  <CommandItem
                    forceMount
                    value={`go to page ${page}`}
                    disabled={page < 1 || page > reader.pageCount}
                    onSelect={() => run(() => reader.goToPage(page - 1))}
                  >
                    <HashIcon /> Go to page {page}
                    <CommandShortcut>of {reader.pageCount}</CommandShortcut>
                  </CommandItem>
                </CommandGroup>
              ) : null}
              {reader ? (
                <CommandGroup heading={`This book: ${reader.title}`}>
                  <CommandItem
                    onSelect={() => run(reader.toggleSidebar)}
                    value="toggle contents sidebar"
                  >
                    <PanelLeftIcon /> Toggle contents sidebar <CommandShortcut>O</CommandShortcut>
                  </CommandItem>
                  <CommandItem
                    onSelect={() => run(reader.togglePanel)}
                    value="toggle annotations panel"
                  >
                    <PanelRightIcon /> Toggle annotations panel <CommandShortcut>P</CommandShortcut>
                  </CommandItem>
                  <CommandItem onSelect={() => run(reader.zoomIn)} value="zoom in">
                    <ZoomInIcon /> Zoom in <CommandShortcut>+</CommandShortcut>
                  </CommandItem>
                  <CommandItem onSelect={() => run(reader.zoomOut)} value="zoom out">
                    <ZoomOutIcon /> Zoom out <CommandShortcut>-</CommandShortcut>
                  </CommandItem>
                  <CommandItem onSelect={() => run(reader.fitWidth)} value="fit width">
                    <ZoomInIcon /> Fit width <CommandShortcut>0</CommandShortcut>
                  </CommandItem>
                  <CommandItem onSelect={() => run(reader.fitPage)} value="fit page">
                    <ZoomInIcon /> Fit page
                  </CommandItem>
                </CommandGroup>
              ) : null}
              <CommandGroup heading="Go">
                <CommandItem onSelect={() => run(() => router.push("/app"))} value="library home">
                  <BookOpenIcon /> Library
                </CommandItem>
                <CommandItem
                  onSelect={() => run(() => router.push("/app/notes"))}
                  value="notes notebook"
                >
                  <NotebookPenIcon /> Notes
                </CommandItem>
                <CommandItem
                  onSelect={() => run(() => router.push("/app/settings"))}
                  value="open settings storage"
                >
                  <SettingsIcon /> Open settings
                </CommandItem>
              </CommandGroup>
              <CommandGroup heading="Actions">
                <CommandItem
                  onSelect={() => run(() => nextTheme && setPreference(nextTheme))}
                  value="toggle theme"
                >
                  <PaletteIcon /> Toggle theme <CommandShortcut>T</CommandShortcut>
                </CommandItem>
                <CommandItem onSelect={() => run(palette.openHelp)} value="keyboard shortcuts help">
                  <KeyboardIcon /> Keyboard shortcuts <CommandShortcut>?</CommandShortcut>
                </CommandItem>
              </CommandGroup>
              {reader && reader.chapters.length > 0 ? (
                <CommandGroup heading="Chapters">
                  {reader.chapters.map((c, i) => (
                    <CommandItem
                      // biome-ignore lint/suspicious/noArrayIndexKey: outline entries have no id
                      key={`${i}-${c.title}`}
                      value={`chapter ${c.title} ${i}`}
                      onSelect={() => run(() => reader.goToChapter(c.page, c.offsetPt))}
                    >
                      <ListIcon />
                      <span className="truncate" style={{ paddingLeft: `${c.depth * 0.75}rem` }}>
                        {c.title}
                      </span>
                      <CommandShortcut>p. {c.page + 1}</CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {reader && reader.annotations.length > 0 ? (
                <CommandGroup heading="Highlights and notes">
                  {reader.annotations.slice(0, 300).map((a) => (
                    <CommandItem
                      key={a.id}
                      value={`annotation ${a.quote} ${a.comment} ${a.id}`}
                      onSelect={() => run(() => reader.jumpToAnnotation(a.id))}
                    >
                      <HighlighterIcon />
                      <span className="truncate">{a.quote || a.comment || "Bookmark"}</span>
                      <CommandShortcut>p. {a.page + 1}</CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              {books.length > 0 ? (
                <CommandGroup heading="Books">
                  {books.map((b) => (
                    <CommandItem
                      key={b.id}
                      value={`book ${b.title} ${b.author ?? ""} ${b.id}`}
                      onSelect={() => run(() => router.push(`/app/read/${b.id}`))}
                    >
                      <BookOpenIcon />
                      <span className="truncate">{b.title}</span>
                      {b.author ? <CommandShortcut>{b.author}</CommandShortcut> : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
      <ShortcutSheet open={help} />
    </>
  );
}

const SHORTCUTS: { group: string; rows: [string[], string][] }[] = [
  {
    group: "Everywhere",
    rows: [
      [["Ctrl/Cmd", "K"], "Command palette"],
      [["?"], "This shortcut list"],
    ],
  },
  {
    group: "Reading",
    rows: [
      [["J", "K"], "Scroll down / up (also arrow keys)"],
      [["Space"], "Page down (Shift+Space: up)"],
      [["PageDown", "PageUp"], "Next / previous page (also Right / Left)"],
      [["Home", "End"], "First / last page"],
      [["G"], "Go to page"],
      [["+", "-", "0"], "Zoom in / out / fit width"],
      [["T"], "Cycle theme"],
      [["[", "]"], "Previous / next chapter"],
      [["O"], "Toggle contents sidebar"],
      [["P"], "Toggle annotations panel"],
      [["B"], "Bookmark this page"],
    ],
  },
  {
    group: "With a selection",
    rows: [
      [["1", "–", "5"], "Highlight in a color"],
      [["N"], "Add a note"],
      [["Shift", "C"], "Copy with citation"],
      [["Esc"], "Clear the selection"],
    ],
  },
  {
    group: "On a focused highlight",
    rows: [
      [["1", "–", "5"], "Change color"],
      [["N"], "Edit the note"],
      [["J", "K"], "Next / previous highlight"],
      [["Delete"], "Remove it"],
      [["Ctrl/Cmd", "Z"], "Undo the last change"],
    ],
  },
];

function ShortcutSheet({ open }: { open: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && palette.closeHelp()}>
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
        data-testid="shortcut-sheet"
      >
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Single keys are off while you type in a text field.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {SHORTCUTS.map((g) => (
            <section key={g.group} aria-label={g.group}>
              <h3 className="mb-1 font-medium text-sm">{g.group}</h3>
              <dl className="divide-y rounded-lg border">
                {g.rows.map(([keys, label]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
