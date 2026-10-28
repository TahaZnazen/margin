import { NotesView } from "./notes-view";

export const metadata = { title: "Notes · Margin" };

export default function NotesPage() {
  return (
    <section className="space-y-4">
      <h1 className="font-semibold font-serif text-2xl">Notes</h1>
      <NotesView />
    </section>
  );
}
