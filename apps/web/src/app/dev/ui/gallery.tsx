"use client";

import { Badge } from "@margin/ui/components/badge";
import { Button } from "@margin/ui/components/button";
import { Command, CommandInput, CommandItem, CommandList } from "@margin/ui/components/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@margin/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@margin/ui/components/dropdown-menu";
import { IconButton } from "@margin/ui/components/icon-button";
import { Input } from "@margin/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@margin/ui/components/popover";
import { Progress } from "@margin/ui/components/progress";
import { ScrollArea } from "@margin/ui/components/scroll-area";
import { Separator } from "@margin/ui/components/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@margin/ui/components/sheet";
import { Skeleton } from "@margin/ui/components/skeleton";
import { toast } from "@margin/ui/components/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@margin/ui/components/tabs";
import { Textarea } from "@margin/ui/components/textarea";
import { ThemeSwitch } from "@margin/ui/components/theme-switch";
import { ToggleGroup, ToggleGroupItem } from "@margin/ui/components/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@margin/ui/components/tooltip";
import { HIGHLIGHT_COLORS, HIGHLIGHT_PALETTE } from "@margin/ui/highlight";
import { THEMES, type Theme } from "@margin/ui/theme";
import { BookmarkIcon, HighlighterIcon, SearchIcon } from "lucide-react";
import type { ReactNode } from "react";

const COLOR_TOKENS = [
  "bg",
  "surface",
  "surface-raised",
  "surface-hover",
  "text",
  "text-muted",
  "border",
  "border-strong",
  "accent",
  "accent-subtle",
  "danger",
  "success",
] as const;

const TYPE_CLASSES = [
  "text-caption",
  "text-ui-sm",
  "text-ui",
  "text-body",
  "text-title-sm",
  "text-title",
  "text-display",
];
const HL_FILL = {
  key: "hl-fill-key",
  definition: "hl-fill-definition",
  example: "hl-fill-example",
  memorize: "hl-fill-memorize",
  confusing: "hl-fill-confusing",
} as const;
const RADII = ["rounded-sm", "rounded-md", "rounded-lg", "rounded-xl", "rounded-2xl"];
const SHADOWS = ["shadow-xs", "shadow-sm", "shadow-md", "shadow-lg"];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-medium text-caption text-text-muted uppercase tracking-wider">{title}</h3>
      {children}
    </section>
  );
}

function ThemePanel({ theme }: { theme: Theme }) {
  return (
    <div
      className={`${theme} flex min-w-0 flex-col gap-8 rounded-xl border bg-background p-6 text-foreground`}
      data-testid={`panel-${theme}`}
    >
      <h2 className="font-serif text-title capitalize">{theme}</h2>

      <Section title="Colors">
        <div className="grid grid-cols-4 gap-2">
          {COLOR_TOKENS.map((t) => (
            <div key={t} className="flex flex-col gap-1">
              <div className="h-8 rounded-md border" style={{ background: `var(--${t})` }} />
              <span className="text-caption text-text-muted">{t}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type, radius, shadow">
        <div className="flex flex-col gap-1">
          {TYPE_CLASSES.map((c) => (
            <span key={c} className={c}>
              {c} · The page is the hero
            </span>
          ))}
          <span className="font-serif text-title">Book title in serif</span>
        </div>
        <div className="flex flex-wrap gap-3">
          {RADII.map((c) => (
            <div
              key={c}
              className={`grid h-10 w-16 place-items-center border bg-surface text-caption ${c}`}
            >
              {c.slice(8)}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          {SHADOWS.map((c) => (
            <div
              key={c}
              className={`grid h-10 w-16 place-items-center rounded-md bg-surface-raised text-caption ${c}`}
            >
              {c.slice(7)}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Highlights (fill, underline, chip)">
        <div className="flex flex-col gap-2">
          {HIGHLIGHT_COLORS.map((c) => (
            <div key={c} className="flex items-center gap-3">
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ background: `var(--hl-${c}-chip)` }}
              />
              <span className="font-serif text-body text-text">
                <span
                  className={`${HL_FILL[c]} px-1 underline decoration-2`}
                  style={{ textDecorationColor: `var(--hl-${c}-underline)` }}
                >
                  {HIGHLIGHT_PALETTE[c].meaning}: text under the highlight
                </span>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Delete</Button>
          <Button disabled>Disabled</Button>
          <IconButton label="Bookmark" shortcut="B">
            <BookmarkIcon />
          </IconButton>
          <Badge>Badge</Badge>
          <Badge variant="outline">Outline</Badge>
        </div>
      </Section>

      <Section title="Inputs">
        <Input placeholder="Search your library" aria-label={`Search ${theme}`} />
        <Textarea placeholder="Write a note" aria-label={`Note ${theme}`} />
        <ToggleGroup
          type="single"
          variant="outline"
          defaultValue="a"
          aria-label={`Toggle ${theme}`}
        >
          <ToggleGroupItem value="a">One</ToggleGroupItem>
          <ToggleGroupItem value="b">Two</ToggleGroupItem>
          <ToggleGroupItem value="c">Three</ToggleGroupItem>
        </ToggleGroup>
        <Progress value={42} aria-label={`Progress ${theme}`} />
        <div className="flex items-center gap-2">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Separator />
      </Section>

      <Section title="Tabs and scroll">
        <Tabs defaultValue="outline">
          <TabsList>
            <TabsTrigger value="outline">Outline</TabsTrigger>
            <TabsTrigger value="pages">Pages</TabsTrigger>
          </TabsList>
          <TabsContent value="outline">
            <ScrollArea className="h-20 rounded-md border p-2">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <p key={n} className="text-ui">
                  Chapter {n}
                </p>
              ))}
            </ScrollArea>
          </TabsContent>
          <TabsContent value="pages">Thumbnails</TabsContent>
        </Tabs>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete highlight?</DialogTitle>
                <DialogDescription>It can be restored from the notebook.</DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Sheet</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Annotations</SheetTitle>
                <SheetDescription>Mobile panel.</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">Popover</Button>
            </PopoverTrigger>
            <PopoverContent>Selection actions live here.</PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Tooltip</Button>
            </TooltipTrigger>
            <TooltipContent>Quiet hint</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Export Markdown</DropdownMenuItem>
              <DropdownMenuItem>Export Anki</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={() => toast("Highlight saved")}>
            Toast
          </Button>
        </div>
        <Command className="rounded-lg border">
          <CommandInput placeholder="Command palette" />
          <CommandList>
            <CommandItem>
              <SearchIcon /> Search in book
            </CommandItem>
            <CommandItem>
              <HighlighterIcon /> Highlight selection
            </CommandItem>
          </CommandList>
        </Command>
      </Section>
    </div>
  );
}

export function Gallery() {
  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="font-serif text-display">Anagnosis UI</h1>
        <ThemeSwitch />
      </header>
      <div className="grid gap-6 lg:grid-cols-3">
        {THEMES.map((t) => (
          <ThemePanel key={t} theme={t} />
        ))}
      </div>
    </main>
  );
}
