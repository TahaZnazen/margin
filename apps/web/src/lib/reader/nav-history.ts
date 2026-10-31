/** Back/forward history for jumps made by links inside the PDF (N2). Pure, so it is unit tested. */

export interface NavPos {
  /** 0-based page. */
  page: number;
  /** Distance from the top of the page in points. */
  offsetPt: number;
}

export interface NavHistory {
  back: NavPos[];
  forward: NavPos[];
}

export const MAX_HISTORY = 50;
/** The Back pill hides after this long, or once the reader scrolls this many pages from the landing. */
export const PILL_MS = 15_000;
export const PILL_FAR_PAGES = 3;

export const emptyHistory: NavHistory = { back: [], forward: [] };

/** A link was followed from `from`: remember it and drop the forward stack. */
export function pushJump(history: NavHistory, from: NavPos): NavHistory {
  const back = [...history.back, from].slice(-MAX_HISTORY);
  return { back, forward: [] };
}

/** Pops the last place; `current` becomes reachable with Forward. Null when there is nothing to go back to. */
export function goBack(
  history: NavHistory,
  current: NavPos,
): { history: NavHistory; target: NavPos } | null {
  const target = history.back.at(-1);
  if (!target) return null;
  return {
    target,
    history: { back: history.back.slice(0, -1), forward: [...history.forward, current] },
  };
}

export function goForward(
  history: NavHistory,
  current: NavPos,
): { history: NavHistory; target: NavPos } | null {
  const target = history.forward.at(-1);
  if (!target) return null;
  return {
    target,
    history: { back: [...history.back, current], forward: history.forward.slice(0, -1) },
  };
}

/** True when the reader has moved far enough from where the link landed that "Back" is stale. */
export const farFromLanding = (landingPage: number, page: number) =>
  Math.abs(page - landingPage) >= PILL_FAR_PAGES;
