import { pdfJsEngine, ReaderError } from "@margin/reader";
import { titleFromFileName } from "./validate";

const COVER_WIDTH_PX = 360;

export interface Extracted {
  title: string;
  author: string | null;
  pageCount: number;
  hasTextLayer: boolean;
  outline: unknown;
  cover: Blob | null;
}

export class IngestError extends Error {}

/** Opens the PDF with the engine, reads its metadata and renders page 1 as `cover.webp`. */
export async function extractMetadata(file: File): Promise<Extracted> {
  let doc: Awaited<ReturnType<typeof pdfJsEngine.open>>;
  try {
    doc = await pdfJsEngine.open(await file.arrayBuffer());
  } catch (error) {
    if (error instanceof ReaderError && error.code === "password-cancelled") {
      throw new IngestError(
        `"${file.name}" is password-protected. Password-protected PDFs are not supported yet.`,
      );
    }
    throw new IngestError(`"${file.name}" looks corrupted and cannot be opened.`);
  }
  try {
    const [title, author, outline, firstPage] = await Promise.all([
      doc.title(),
      doc.author(),
      doc.outline(),
      doc.pageText(0).catch(() => null),
    ]);
    let hasTextLayer = Boolean(firstPage?.text.trim());
    if (!hasTextLayer && doc.pageCount > 1) {
      hasTextLayer = Boolean((await doc.pageText(1).catch(() => null))?.text.trim());
    }
    return {
      title: title ?? titleFromFileName(file.name),
      author: author ?? null,
      pageCount: doc.pageCount,
      hasTextLayer,
      outline,
      cover: await renderCover(doc).catch(() => null),
    };
  } finally {
    await doc.destroy();
  }
}

async function renderCover(
  doc: Awaited<ReturnType<typeof pdfJsEngine.open>>,
): Promise<Blob | null> {
  const geometry = await doc.pageGeometry(0);
  const rotated = geometry.rotation === 90 || geometry.rotation === 270;
  const widthPt = rotated ? geometry.height : geometry.width;
  const canvas = document.createElement("canvas");
  await doc.renderPage(0, canvas, { scale: COVER_WIDTH_PX / widthPt, pixelRatio: 1 });
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.8));
}
