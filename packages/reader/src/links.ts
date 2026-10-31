/** Pure helpers for PDF links (no PDF.js import, so they run in unit tests). */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * The URL as a normalized string when it is safe to open (http, https, mailto), otherwise null.
 * `javascript:`, `data:`, `file:` and everything else, and strings that do not parse, are refused.
 */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** Short accessible name for an external link: the host, or the address of a mailto link. */
export function externalLinkLabel(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "mailto:") return `Email ${decodeURIComponent(parsed.pathname)}`;
    return `Open link to ${parsed.host.replace(/^www\./, "")}`;
  } catch {
    return "Open link";
  }
}

/** Accessible name for an internal link: "Go to page 12". */
export const internalLinkLabel = (pageIndex: number) => `Go to page ${pageIndex + 1}`;
