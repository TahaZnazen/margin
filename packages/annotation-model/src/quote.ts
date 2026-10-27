import type { Quote } from "./target";
import { QUOTE_CONTEXT_LENGTH } from "./vocabulary";

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Builds the text quote for `pageText.slice(start, end)`: the exact text plus up to 32 UTF-16
 * code units of context on each side. Context that would start or end inside a surrogate pair
 * (an emoji, say) is trimmed by one unit so it never holds half a character.
 */
export function buildQuote(pageText: string, start: number, end: number): Quote {
  if (!(Number.isInteger(start) && Number.isInteger(end))) {
    throw new RangeError(`start and end must be integers, got ${start} and ${end}`);
  }
  if (!(start >= 0 && start < end && end <= pageText.length)) {
    throw new RangeError(
      `Need 0 <= start < end <= ${pageText.length} (the page text length), got ${start} and ${end}`,
    );
  }

  let prefix = pageText.slice(Math.max(0, start - QUOTE_CONTEXT_LENGTH), start);
  if (isLowSurrogate(prefix.charCodeAt(0))) prefix = prefix.slice(1);

  let suffix = pageText.slice(end, end + QUOTE_CONTEXT_LENGTH);
  if (isHighSurrogate(suffix.charCodeAt(suffix.length - 1))) suffix = suffix.slice(0, -1);

  return { exact: pageText.slice(start, end), prefix, suffix };
}
