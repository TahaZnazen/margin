import Link from "next/link";

export const metadata = { title: "Library · Margin" };

export default function LibraryPage() {
  return (
    <section className="max-w-2xl space-y-3">
      <h1 className="font-semibold font-serif text-2xl">Library</h1>
      <p className="text-muted-foreground text-sm">Your documents will appear here.</p>
      <Link href="/dev/reader" className="text-primary text-sm underline underline-offset-4">
        Open the reader
      </Link>
    </section>
  );
}
