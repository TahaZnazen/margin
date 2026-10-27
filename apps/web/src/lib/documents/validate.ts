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
