import { deepLink } from "@/lib/export/markdown";
import { pageLink } from "@/lib/reader/chapters";

export interface CitationInput {
  quote: string;
  title: string;
  /** 0-based page index. */
  page: number;
  origin: string;
  documentId: string;
  /** A saved highlight links to its rectangle (#a=); a plain selection links to the page (#p=). */
  annotationId?: string | null;
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function citationLink(
  i: Pick<CitationInput, "origin" | "documentId" | "annotationId" | "page">,
) {
  return i.annotationId
    ? deepLink(i.origin, i.documentId, i.annotationId)
    : pageLink(i.origin.replace(/\/$/, ""), i.documentId, i.page);
}

/** The clipboard payload: plain text and an HTML variant. Quote and title are escaped in the HTML. */
export function buildCitation(i: CitationInput): { text: string; html: string; url: string } {
  const url = citationLink(i);
  const cite = `${i.title}, p. ${i.page + 1}`;
  return {
    url,
    text: `"${i.quote}" — ${cite}\n${url}`,
    html: `<blockquote>${escapeHtml(i.quote)}</blockquote><p>— <a href="${escapeHtml(url)}">${escapeHtml(cite)}</a></p>`,
  };
}

/** Writes text/plain + text/html, falling back to plain text. Resolves to whether anything was copied; never throws. */
export async function copyRich(text: string, html?: string): Promise<boolean> {
  try {
    const clip = navigator.clipboard;
    if (html && clip && typeof ClipboardItem !== "undefined" && typeof clip.write === "function") {
      try {
        await clip.write([
          new ClipboardItem({
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
        return true;
      } catch {
        // fall through to plain text
      }
    }
    await clip.writeText(text);
    return true;
  } catch {
    return false;
  }
}
