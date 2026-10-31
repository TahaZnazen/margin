/** Reading pace and time left. Pure, so the rules are easy to test. */

/** No estimate until the reader has gone this far and spent this long. */
export const MIN_PAGES_ADVANCED = 3;
export const MIN_SECONDS_READ = 120;
/**
 * A pace faster than this is not reading: the reader jumped ahead (chapter link, slider), started
 * in the middle, or skimmed. Showing "time left" from it would be far too optimistic, so show none.
 */
export const MIN_SECONDS_PER_PAGE = 10;

/** The page being read counts as half unread. */
const CURRENT_PAGE_LEFT = 0.5;

/**
 * Seconds per page, from the time spent reading and the pages advanced (0-based current page).
 * Null until there is enough data to trust (3+ pages, 2+ minutes) or when the implied pace is implausibly fast (under 10 s per page).
 */
export function paceSecondsPerPage(secondsRead: number, page: number): number | null {
  if (!Number.isFinite(secondsRead) || !Number.isFinite(page)) return null;
  if (page < MIN_PAGES_ADVANCED || secondsRead < MIN_SECONDS_READ) return null;
  const pace = secondsRead / page;
  return pace < MIN_SECONDS_PER_PAGE ? null : pace;
}

/** Seconds to read the rest of the current page and every page after it, to the end of the book; null without a pace. */
export function secondsLeftInBook(
  pace: number | null,
  page: number,
  pageCount: number,
): number | null {
  if (pace === null || pageCount <= 0) return null;
  const remaining = pageCount - page - CURRENT_PAGE_LEFT;
  return remaining > 0 ? remaining * pace : null;
}

/** Seconds to read from the current page to the page before `endPage` (0-based, exclusive). */
export function secondsLeftInRange(
  pace: number | null,
  page: number,
  endPage: number,
): number | null {
  if (pace === null) return null;
  const remaining = endPage - page - CURRENT_PAGE_LEFT;
  return remaining > 0 ? remaining * pace : null;
}

/** "under 1 min", "12 min", "2 h": rounded, no "about". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return "under 1 min";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(seconds / 3600);
  return `${Math.max(hours, 1)} h`;
}

/** "about 12 min left". */
export function formatTimeLeft(seconds: number): string {
  const d = formatDuration(seconds);
  return d.startsWith("under") ? `${d} left` : `about ${d} left`;
}

/** "p. 5 of 9 · 56 % · about 12 min left", or null for a book that was never read. */
export function libraryProgressLine(input: {
  page: number | null;
  pageCount: number | null;
  percent: number;
  secondsRead: number;
}): string | null {
  const { page, pageCount, percent, secondsRead } = input;
  if (page === null || !pageCount) return null;
  if (page <= 0) return null; // never opened, or never past the first page
  const parts = [`p. ${page + 1} of ${pageCount}`, `${Math.round(percent)} %`];
  const left = secondsLeftInBook(paceSecondsPerPage(secondsRead, page), page, pageCount);
  if (left !== null) parts.push(formatTimeLeft(left));
  return parts.join(" · ");
}
