import { HighlightsView } from "./highlights-view";

export const metadata = { title: "Highlights · Margin" };

export default function HighlightsPage() {
  return (
    <section className="space-y-4">
      <h1 className="font-semibold font-serif text-2xl">Highlights</h1>
      <HighlightsView />
    </section>
  );
}
