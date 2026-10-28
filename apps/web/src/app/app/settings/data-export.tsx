"use client";

import { Button } from "@margin/ui/components/button";
import { toast } from "@margin/ui/components/sonner";
import { useState } from "react";
import { exportEverything, saveBlob } from "@/lib/export/client";

export function DataExport() {
  const [includePdfs, setIncludePdfs] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function run() {
    setBusy("Starting…");
    try {
      const { bytes, counts, skippedPdfs } = await exportEverything(includePdfs, (p) =>
        setBusy(`${p.step} (${p.done + 1}/${p.total})`),
      );
      const stamp = new Date().toISOString().slice(0, 10);
      saveBlob(`margin-export-${stamp}.zip`, bytes as BlobPart, "application/zip");
      toast.success(
        `Exported ${counts.documents} books, ${counts.annotations} annotations and ${counts.notes} notes.`,
      );
      if (skippedPdfs.length > 0) {
        toast.warning(`Couldn't include the PDF of: ${skippedPdfs.join(", ")}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The export failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="data-heading">
      <h2 id="data-heading" className="font-medium text-lg">
        Data
      </h2>
      <p className="text-muted-foreground text-sm">
        Your highlights, notes and books are yours. The export is a zip with every book as Markdown,
        a JSON file with all your records, and optionally the PDFs.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid="export-include-pdfs"
          checked={includePdfs}
          onChange={(e) => setIncludePdfs(e.target.checked)}
        />
        Include the PDF files (can be large)
      </label>
      <Button data-testid="export-everything" disabled={busy !== null} onClick={() => void run()}>
        {busy ?? "Export everything"}
      </Button>
    </section>
  );
}
