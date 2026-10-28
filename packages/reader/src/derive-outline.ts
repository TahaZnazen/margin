/**
 * Chapter list for PDFs that carry no outline: large-font headings and "Chapter N" lines.
 * Pure over `PageText`, so it is unit-testable without an engine; `deriveOutline` drives it lazily.
 */
import type { OutlineItem, PageText, ReaderDocument, TextRun } from "./engine";

const CHAPTER_WORD =
  /^(chapter|part|section|unit|appendix|chapitre|partie|annexe|kapitel|teil|capitulo|capítulo|capitolo)\s+([0-9]+|[ivxlcdm]+|[a-z])\b/i;
const NUMBERED = /^\d{1,2}(\.\d{1,2})?\.?\s+\p{L}/u;

const MIN_RATIO = 1.25;
const MAX_TITLE_CHARS = 100;

interface Line {
  text: string;
  size: number;
  y: number;
}

function lineGroups(runs: TextRun[]): Line[] {
  const upright = runs.filter((r) => r.angle === 0 && r.str.trim().length > 0);
  const lines: { runs: TextRun[]; y: number }[] = [];
  for (const run of upright) {
    const home = lines.find((l) => Math.abs(l.y - run.y) < run.fontSize * 0.35);
    if (home) home.runs.push(run);
    else lines.push({ runs: [run], y: run.y });
  }
  return lines
    .map((l) => {
      const ordered = [...l.runs].sort((a, b) => a.x - b.x);
      return {
        text: ordered
          .map((r) => r.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
        size: Math.max(...ordered.map((r) => r.fontSize)),
        y: l.y,
      };
    })
    .sort((a, b) => a.y - b.y);
}

/** The most common font size by characters drawn: that is the body text. */
export function bodyFontSize(pages: readonly (PageText | null)[]): number {
  const weight = new Map<number, number>();
  for (const page of pages) {
    for (const run of page?.runs ?? []) {
      if (run.angle !== 0) continue;
      const key = Math.round(run.fontSize * 2) / 2;
      weight.set(key, (weight.get(key) ?? 0) + run.str.trim().length);
    }
  }
  let best = 0;
  let bestWeight = 0;
  for (const [size, w] of weight) {
    if (w > bestWeight) {
      best = size;
      bestWeight = w;
    }
  }
  return best;
}

const norm = (s: string) => s.toLowerCase().replace(/[\d\s.]+/g, "");

/**
 * One heading per page at most (the largest, earliest group of heading lines). Returns a flat
 * list, in page order, or [] when nothing credible stands out.
 */
export function deriveChapters(pages: readonly (PageText | null)[]): OutlineItem[] {
  const body = bodyFontSize(pages);
  if (body <= 0) return [];
  const found: { page: number; title: string; size: number }[] = [];
  pages.forEach((page, index) => {
    if (!page) return;
    const lines = lineGroups(page.runs);
    const isHeading = (l: Line) =>
      l.text.length >= 3 &&
      l.text.length <= MAX_TITLE_CHARS &&
      /\p{L}/u.test(l.text) &&
      (l.size >= body * MIN_RATIO ||
        (l.size >= body * 1.05 && (CHAPTER_WORD.test(l.text) || NUMBERED.test(l.text))));
    const flagged = lines.map(isHeading);
    // A page that is mostly "headings" is a poster or a title wall, not a chapter start.
    if (flagged.filter(Boolean).length > 6) return;
    const groups: { text: string; size: number }[] = [];
    let current: { text: string; size: number; y: number } | null = null;
    lines.forEach((line, i) => {
      if (!flagged[i]) {
        current = null;
        return;
      }
      if (current && line.y - current.y < Math.max(current.size, line.size) * 3) {
        current.text = `${current.text} ${line.text}`.trim();
        current.size = Math.max(current.size, line.size);
        current.y = line.y;
      } else {
        current = { text: line.text, size: line.size, y: line.y };
        groups.push(current);
      }
    });
    const top = groups.reduce<{ text: string; size: number } | null>(
      (best, g) => (!best || g.size > best.size + 0.5 ? g : best),
      null,
    );
    if (top && top.text.length <= MAX_TITLE_CHARS * 1.5) {
      found.push({ page: index, title: top.text, size: top.size });
    }
  });
  // Running headers repeat on many pages; a real chapter title does not.
  const counts = new Map<string, number>();
  for (const f of found) counts.set(norm(f.title), (counts.get(norm(f.title)) ?? 0) + 1);
  const kept = found.filter((f) => {
    const n = counts.get(norm(f.title)) ?? 0;
    return norm(f.title).length > 0 && (n < 3 || n / Math.max(found.length, 1) < 0.25);
  });
  if (kept.length < 2) return [];
  if (pages.length >= 12 && kept.length > pages.length * 0.6) return [];
  return kept.map((f) => ({ title: f.title, page: f.page, offsetPt: 0, children: [] }));
}

export interface DeriveOptions {
  signal?: AbortSignal;
  /** Pages scanned at most (from the start). */
  maxPages?: number;
  /** Wall-clock budget; the scan stops with what it has. */
  budgetMs?: number;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Scans page text lazily (yielding to the UI between pages) and derives a flat chapter list. */
export async function deriveOutline(
  doc: ReaderDocument,
  { signal, maxPages = 400, budgetMs = 6000 }: DeriveOptions = {},
): Promise<OutlineItem[]> {
  const started = performance.now();
  const count = Math.min(doc.pageCount, maxPages);
  const pages: (PageText | null)[] = [];
  for (let i = 0; i < count; i++) {
    if (signal?.aborted) return [];
    if (performance.now() - started > budgetMs) break;
    pages.push(await doc.pageText(i).catch(() => null));
    if (i % 4 === 3) await tick();
  }
  return deriveChapters(pages);
}
