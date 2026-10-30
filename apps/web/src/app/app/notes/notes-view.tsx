"use client";

import { Button } from "@margin/ui/components/button";
import { Input } from "@margin/ui/components/input";
import { toast } from "@margin/ui/components/sonner";
import { cn } from "@margin/ui/lib/utils";
import { BookOpenIcon, PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NoteEditor } from "@/components/notes/note-editor";
import { services } from "@/lib/documents/services";
import { asDoc, EMPTY_DOC } from "@/lib/notes/doc";
import type { Note } from "@/lib/notes/notes-repo";
import { useNoteSaver } from "@/lib/notes/use-notebook";
import { uuidv7 } from "@/lib/uuid";

/** Edits one standalone note with the same editor and autosave as the book notebook. */
function StandaloneEditor({ note, onSaved }: { note: Note; onSaved(note: Note): void }) {
  const repo = services().notes;
  const saver = useNoteSaver(
    repo,
    (current) => ({
      id: note.id,
      documentId: null,
      title: current?.title ?? note.title,
      createdAt: note.createdAt,
    }),
    note,
  );
  const [title, setTitle] = useState(note.title ?? "");
  const { schedule, noteRef, pending } = saver;
  const lastDoc = noteRef;

  const rename = (value: string) => {
    setTitle(value);
    const current = noteRef.current ?? note;
    noteRef.current = { ...current, title: value };
    schedule(asDoc(current.docJson));
  };

  useEffect(() => {
    if (pending === 0 && lastDoc.current) onSaved(lastDoc.current);
  }, [pending, lastDoc, onSaved]);

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-lg border bg-card">
      <Input
        value={title}
        placeholder="Untitled note"
        aria-label="Note title"
        data-testid="note-title"
        className="rounded-b-none border-0 border-b font-serif text-lg"
        onChange={(e) => rename(e.target.value)}
      />
      <NoteEditor
        key={note.id}
        initial={asDoc(note.docJson)}
        onChange={(doc) => {
          const current = noteRef.current ?? note;
          noteRef.current = { ...current, docJson: doc };
          schedule(doc);
        }}
        className="min-h-[24rem] flex-1"
      />
      <output className="sr-only" data-testid="note-pending">
        {pending}
      </output>
    </div>
  );
}

export function NotesView() {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const { notes: repo, documents } = services();
    Promise.all([repo.list(), documents.list()])
      .then(([list, books]) => {
        setNotes(list);
        setTitles(new Map(books.map((b) => [b.id, b.title])));
      })
      .catch(() => setLoadError(true));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (notes ?? []).filter((n) => {
      // Notebooks of deleted books stay out of the list.
      if (n.documentId && !titles.has(n.documentId)) return false;
      if (!q) return true;
      return `${n.title ?? ""}\n${n.plainText}\n${titles.get(n.documentId ?? "") ?? ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [notes, titles, query]);

  const current = notes?.find((n) => n.id === selected) ?? null;

  const create = async () => {
    const now = new Date().toISOString();
    const note: Note = {
      id: uuidv7(),
      documentId: null,
      title: null,
      docJson: EMPTY_DOC,
      plainText: "",
      createdAt: now,
      updatedAt: now,
    };
    setNotes((prev) => [note, ...(prev ?? [])]);
    setSelected(note.id);
    try {
      await services().notes.save(note);
    } catch {
      setNotes((prev) => (prev ?? []).filter((n) => n.id !== note.id));
      setSelected(null);
      toast.error("Couldn't create the note.");
    }
  };

  const remove = async (note: Note) => {
    setNotes((prev) => (prev ?? []).filter((n) => n.id !== note.id));
    setSelected(null);
    try {
      await services().notes.remove(note.id);
    } catch {
      setNotes((prev) => [note, ...(prev ?? [])]);
      toast.error("Couldn't delete the note.");
    }
  };

  const onSaved = useCallback((saved: Note) => {
    setNotes((prev) =>
      (prev ?? []).map((n) =>
        n.id === saved.id
          ? { ...n, title: saved.title, plainText: saved.plainText, docJson: saved.docJson }
          : n,
      ),
    );
  }, []);

  return (
    <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            type="search"
            placeholder="Search notes"
            aria-label="Search notes"
            data-testid="notes-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button size="icon" aria-label="New note" data-testid="new-note" onClick={create}>
            <PlusIcon />
          </Button>
        </div>
        {notes === null && !loadError ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : null}
        {loadError ? (
          <p className="text-destructive text-sm" role="alert" data-testid="notes-error">
            Couldn't load your notes. Check your connection and reload the page.
          </p>
        ) : null}
        {notes && filtered.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="notes-empty">
            {notes.length === 0
              ? "No notes yet. Create one, or open a book's notebook."
              : "No match."}
          </p>
        ) : null}
        <ul className="space-y-1">
          {filtered.map((n) => {
            const book = n.documentId ? titles.get(n.documentId) : null;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  data-testid="note-row"
                  data-kind={n.documentId ? "book" : "standalone"}
                  className={cn(
                    "w-full rounded-md border p-2 text-left text-sm hover:bg-accent/40",
                    selected === n.id && "bg-accent/60",
                  )}
                  onClick={() => setSelected(n.id)}
                >
                  <span className="flex items-center gap-1 font-medium">
                    {n.documentId ? <BookOpenIcon className="size-3.5 shrink-0" /> : null}
                    <span className="truncate">{book ?? n.title ?? "Untitled note"}</span>
                  </span>
                  <span className="line-clamp-2 text-muted-foreground text-xs">
                    {n.plainText || "Empty"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex min-h-[24rem] flex-col gap-2">
        {current && !current.documentId ? (
          <>
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                data-testid="delete-note"
                onClick={() => void remove(current)}
              >
                <Trash2Icon /> Delete
              </Button>
            </div>
            <StandaloneEditor key={current.id} note={current} onSaved={onSaved} />
          </>
        ) : null}
        {current?.documentId ? (
          <div className="space-y-3 rounded-lg border bg-card p-4" data-testid="book-notebook">
            <h2 className="font-medium font-serif text-lg">
              {titles.get(current.documentId) ?? "Notebook"}
            </h2>
            <p className="whitespace-pre-wrap text-sm">{current.plainText || "Empty notebook."}</p>
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/read/${current.documentId}`}>Open in the reader</Link>
            </Button>
          </div>
        ) : null}
        {!current ? (
          <p className="text-muted-foreground text-sm">Select a note to read or edit it.</p>
        ) : null}
      </div>
    </div>
  );
}
