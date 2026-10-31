import type { FindState } from "@margin/reader";

/** "3 of 17", "No matches", "Searching…" (or nothing before the first query). */
export function findCountLabel(find: FindState, typed: string): string {
  if (!typed.trim()) return "";
  if (find.query !== typed) return "Searching…";
  if (find.total > 0) return `${find.current + 1} of ${find.total}${find.searching ? "+" : ""}`;
  return find.searching ? "Searching…" : "No matches";
}
