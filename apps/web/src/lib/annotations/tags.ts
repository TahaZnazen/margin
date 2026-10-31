import { z } from "zod";

export const MAX_TAG_LENGTH = 32;
export const MAX_TAGS = 10;

/**
 * One tag: trimmed, lowercase, spaces become `-`, no leading `#`, only letters, digits, `_` and `-`,
 * at most 32 characters. Returns null when nothing is left.
 */
export function normalizeTag(raw: string): string | null {
  const tag = raw
    .normalize("NFC")
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/\s+/gu, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, MAX_TAG_LENGTH)
    .replace(/-+$/, "");
  return tag || null;
}

/** Normalizes every tag, drops empties and duplicates (first wins), keeps at most 10. */
export function normalizeTags(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const tag = normalizeTag(raw);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

const TagList = z.array(z.string());

/** The `annotations.tags` column (JSON text locally, jsonb on the server) as a clean list. */
export function parseTags(value: unknown): string[] {
  let json = value;
  if (typeof value === "string") {
    try {
      json = JSON.parse(value);
    } catch {
      return [];
    }
  }
  const parsed = TagList.safeParse(json);
  return parsed.success ? normalizeTags(parsed.data) : [];
}

export const serializeTags = (tags: readonly string[]): string =>
  JSON.stringify(normalizeTags(tags));

/** Tags already used, most used first (ties alphabetical), for suggestions and filter chips. */
export function tagCounts(lists: Iterable<readonly string[]>): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const tags of lists) for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** `#renal #exam-2`, or an empty string. */
export const tagWords = (tags: readonly string[]): string =>
  normalizeTags(tags)
    .map((t) => `#${t}`)
    .join(" ");

const TAGS_PREFIX = "Tags: ";

/** `/Contents` of a PDF annotation: the comment, then a last line `Tags: #a #b` (the prefix keeps real comments ending in hashtags safe). */
export function contentsWithTags(comment: string | null, tags: readonly string[]): string | null {
  const words = tagWords(tags);
  if (!words) return comment;
  const line = `${TAGS_PREFIX}${words}`;
  return comment ? `${comment}\n${line}` : line;
}

const TAG_WORD = /^#[\p{L}\p{N}_-]+$/u;

/** Inverse of `contentsWithTags`: only a last line `Tags: #a #b` is read as the tags. */
export function splitContentsTags(contents: string | null): {
  comment: string | null;
  tags: string[];
} {
  if (!contents) return { comment: contents, tags: [] };
  const lines = contents.split("\n");
  const last = (lines.at(-1) ?? "").trim();
  if (!last.startsWith(TAGS_PREFIX)) return { comment: contents, tags: [] };
  const words = last.slice(TAGS_PREFIX.length).trim().split(/\s+/);
  if (words.length === 0 || !words.every((w) => TAG_WORD.test(w))) {
    return { comment: contents, tags: [] };
  }
  const comment = lines.slice(0, -1).join("\n").trim();
  return { comment: comment || null, tags: normalizeTags(words) };
}

/** True when `tags` holds every selected tag (filters narrow: they combine with AND). */
export const hasAllTags = (tags: readonly string[], selected: ReadonlySet<string>): boolean => {
  for (const t of selected) if (!tags.includes(t)) return false;
  return true;
};

/**
 * Filter chips for a pool of items (already narrowed by every other filter): each tag in the pool
 * with the number of items you would get by selecting it on top of the current selection.
 * Selected tags stay listed even when the pool no longer has them.
 */
export function tagFacets(
  pool: readonly { tags: readonly string[] }[],
  selected: ReadonlySet<string>,
): { tag: string; count: number }[] {
  const narrowed = pool.filter((e) => hasAllTags(e.tags, selected));
  const all = new Set<string>(selected);
  for (const e of pool) for (const t of e.tags) all.add(t);
  const counts = new Map(tagCounts(narrowed.map((e) => e.tags)).map((c) => [c.tag, c.count]));
  return [...all]
    .map((tag) => ({ tag, count: counts.get(tag) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
