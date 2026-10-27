import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { devRoutesEnabled } from "@/config/dev-routes";

interface ManifestEntry {
  id: string;
  file: string;
  title: string;
  status?: string;
}

/**
 * Dev only: serves a golden-corpus PDF by manifest id to /dev/reader. The id is looked up in the
 * manifest (never joined into a path), so only corpus files can be read.
 */
export async function GET(request: NextRequest) {
  if (!devRoutesEnabled()) return new Response("Not found", { status: 404 });
  const id = request.nextUrl.searchParams.get("id");
  const dir = join(process.cwd(), "..", "..", "fixtures", "pdfs");
  try {
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as {
      entries: ManifestEntry[];
    };
    const entry = manifest.entries.find((e) => e.id === id);
    if (!entry || entry.status?.startsWith("skipped")) {
      return new Response("Unknown or skipped fixture", { status: 404 });
    }
    const bytes = await readFile(join(dir, entry.file));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "cache-control": "no-store",
        "x-fixture-title": encodeURIComponent(entry.title),
      },
    });
  } catch {
    return new Response("Fixture file missing; run pnpm fixtures", { status: 404 });
  }
}
