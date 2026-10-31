import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "./config";

const PDF_MAGIC = "%PDF-";

/** Returns a user-facing message when the file must not be uploaded, else null. */
export async function rejectReason(file: File): Promise<string | null> {
  const looksPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!looksPdf) return `"${file.name}" is not a PDF. Only PDF files can be added.`;
  if (file.size > MAX_UPLOAD_BYTES) {
    return `"${file.name}" is larger than ${MAX_UPLOAD_LABEL}. Pick a smaller file.`;
  }
  if (file.size === 0) return `"${file.name}" is empty.`;
  const head = await file.slice(0, 1024).text();
  if (!head.includes(PDF_MAGIC)) return `"${file.name}" is not a valid PDF.`;
  return null;
}

export const titleFromFileName = (name: string) => name.replace(/\.pdf$/i, "").trim() || "Untitled";

const sameName = (a: string, b: string) =>
  a
    .replace(/\.pdf$/i, "")
    .trim()
    .toLowerCase() ===
  b
    .replace(/\.pdf$/i, "")
    .trim()
    .toLowerCase();

/**
 * The title to store: the PDF's own Title metadata when it says something, else the biggest line
 * on page 1 (`derived`), else the file name. Metadata that just repeats the file name counts as
 * empty (many tools fill it in that way).
 */
export function chooseTitle(
  metadataTitle: string | undefined,
  fileName: string,
  derived: string | undefined,
): string {
  const fromName = titleFromFileName(fileName);
  const meta = metadataTitle?.trim();
  if (meta && !sameName(meta, fileName) && !sameName(meta, fromName)) return meta;
  return derived?.trim() || fromName;
}
