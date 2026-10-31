/**
 * The PDF.js adapter for ReaderEngine (ADR-0003). The only file that imports `pdfjs-dist`, and it
 * does so lazily, because the library touches DOM globals at import time and must not run during SSR.
 *
 * Parsing, fonts and image decoding run in PDF.js's own Web Worker. PDF JavaScript never runs:
 * the core API has no scripting (it lives in the separate viewer sandbox we do not load), and
 * pdfjs-dist 6 no longer evaluates strings (the old `isEvalSupported` switch is gone).
 */
import type {
  OpenOptions,
  OutlineItem,
  PageGeometry,
  PageLink,
  PageText,
  ReaderDocument,
  ReaderEngine,
  RenderOptions,
  Rotation,
  SearchHit,
} from "./engine";
import { ReaderError } from "./engine";
import { safeExternalUrl } from "./links";
import { findInText, pageTextFromContent } from "./text";

type PdfJs = typeof import("pdfjs-dist");
type PDFDocumentProxy = import("pdfjs-dist").PDFDocumentProxy;
type PDFPageProxy = import("pdfjs-dist").PDFPageProxy;

let libPromise: Promise<PdfJs> | null = null;

function loadLib(assetBaseUrl: string): Promise<PdfJs> {
  libPromise ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = `${assetBaseUrl}pdf.worker.min.mjs`;
    return lib;
  });
  return libPromise;
}

/** The parts of a PDF.js annotation we read (the library types them as `any`). */
interface RawLink {
  subtype?: string;
  rect?: number[];
  dest?: string | unknown[] | null;
  url?: string | null;
  unsafeUrl?: string;
}

const rotationOf = (value: number): Rotation => (((value % 360) + 360) % 360) as Rotation;

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function toReaderError(lib: PdfJs, error: unknown): ReaderError {
  if (error instanceof ReaderError) return error;
  const details = error instanceof Error ? error.message : String(error);
  if (error instanceof lib.InvalidPDFException) {
    return new ReaderError(
      "corrupted",
      "This file doesn't look like a readable PDF. It may be damaged or incomplete.",
      details,
    );
  }
  if (error instanceof lib.ResponseException) {
    return new ReaderError("network", "We couldn't download this file.", details);
  }
  return new ReaderError("unknown", "Something went wrong while opening this file.", details);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

class PdfJsDocument implements ReaderDocument {
  readonly pageCount: number;
  readonly #lib: PdfJs;
  readonly #pdf: PDFDocumentProxy;
  readonly #bytes: Uint8Array;
  readonly #pages = new Map<number, Promise<PDFPageProxy>>();
  readonly #geometry = new Map<number, Promise<PageGeometry>>();
  readonly #text = new Map<number, Promise<PageText>>();
  readonly #links = new Map<number, Promise<PageLink[]>>();
  #fingerprint: Promise<string> | null = null;

  constructor(lib: PdfJs, pdf: PDFDocumentProxy, bytes: Uint8Array) {
    this.#lib = lib;
    this.#pdf = pdf;
    this.#bytes = bytes;
    this.pageCount = pdf.numPages;
  }

  #page(index: number): Promise<PDFPageProxy> {
    let page = this.#pages.get(index);
    if (!page) {
      page = this.#pdf.getPage(index + 1);
      this.#pages.set(index, page);
    }
    return page;
  }

  fingerprint(): Promise<string> {
    this.#fingerprint ??= sha256Hex(this.#bytes).then((hex) => `sha256:${hex}`);
    return this.#fingerprint;
  }

  pageGeometry(index: number): Promise<PageGeometry> {
    let geometry = this.#geometry.get(index);
    if (!geometry) {
      geometry = this.#page(index).then((page) => {
        const [x0, y0, x1, y1] = page.view as number[];
        return {
          width: (x1 as number) - (x0 as number),
          height: (y1 as number) - (y0 as number),
          rotation: rotationOf(page.rotate),
        };
      });
      this.#geometry.set(index, geometry);
    }
    return geometry;
  }

  async renderPage(index: number, canvas: HTMLCanvasElement, opts: RenderOptions): Promise<void> {
    if (opts.signal?.aborted) throw abortError();
    const page = await this.#page(index);
    const viewport = page.getViewport({ scale: opts.scale * opts.pixelRatio });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const task = page.render({
      canvas,
      viewport,
      annotationMode: this.#lib.AnnotationMode.DISABLE,
    });
    const onAbort = () => task.cancel();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await task.promise;
    } catch (error) {
      if (error instanceof this.#lib.RenderingCancelledException) throw abortError();
      throw error;
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }

  pageText(index: number): Promise<PageText> {
    let text = this.#text.get(index);
    if (!text) {
      text = this.#loadText(index);
      this.#text.set(index, text);
    }
    return text;
  }

  async #loadText(index: number): Promise<PageText> {
    const page = await this.#page(index);
    const content = await page.getTextContent();
    return pageTextFromContent(content, page.view as number[]);
  }

  async *search(query: string, signal?: AbortSignal): AsyncIterable<SearchHit> {
    for (let page = 0; page < this.pageCount; page++) {
      if (signal?.aborted) return;
      const { text } = await this.pageText(page);
      for (const hit of findInText(text, query)) yield { page, ...hit };
    }
  }

  async outline(): Promise<OutlineItem[]> {
    const raw = await this.#pdf.getOutline();
    if (!raw) return [];
    type Raw = NonNullable<Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>>[number];
    const convert = async (item: Raw): Promise<OutlineItem> => {
      const target = await this.#resolveDest(item.dest);
      const children = await Promise.all(item.items.map(convert));
      return { title: item.title.trim(), ...target, children };
    };
    return Promise.all(raw.map(convert));
  }

  async #resolveDest(dest: unknown): Promise<{ page?: number; offsetPt?: number }> {
    try {
      const resolved = typeof dest === "string" ? await this.#pdf.getDestination(dest) : dest;
      if (!Array.isArray(resolved) || resolved.length === 0) return {};
      const ref = resolved[0];
      const page =
        typeof ref === "number"
          ? ref
          : await this.#pdf.getPageIndex(ref as { num: number; gen: number });
      const result: { page: number; offsetPt?: number } = { page };
      const kind = (resolved[1] as { name?: string } | undefined)?.name;
      const top =
        kind === "XYZ" ? resolved[3] : kind === "FitH" || kind === "FitBH" ? resolved[2] : null;
      if (typeof top === "number") {
        const geometry = await this.pageGeometry(page);
        const pdfPage = await this.#page(page);
        const y1 = (pdfPage.view as number[])[3] as number;
        result.offsetPt = Math.min(Math.max(y1 - top, 0), geometry.height);
      }
      return result;
    } catch {
      return {};
    }
  }

  links(index: number): Promise<PageLink[]> {
    let links = this.#links.get(index);
    if (!links) {
      links = this.#loadLinks(index).catch(() => []);
      this.#links.set(index, links);
    }
    return links;
  }

  async #loadLinks(index: number): Promise<PageLink[]> {
    const page = await this.#page(index);
    const annotations = await page.getAnnotations({ intent: "display" });
    const [x0 = 0, , , y1 = 0] = page.view as number[];
    const out: PageLink[] = [];
    for (const a of annotations as RawLink[]) {
      if (a.subtype !== "Link" || !Array.isArray(a.rect) || a.rect.length < 4) continue;
      const [ax, ay, bx, by] = a.rect as [number, number, number, number];
      const rect: [number, number, number, number] = [
        Math.min(ax, bx) - x0,
        y1 - Math.max(ay, by),
        Math.max(ax, bx) - x0,
        y1 - Math.min(ay, by),
      ];
      if (!(rect[2] - rect[0] > 0.5 && rect[3] - rect[1] > 0.5)) continue;
      if (a.dest) {
        const target = await this.#resolveDest(a.dest);
        if (target.page !== undefined)
          out.push({
            rect,
            target: { kind: "internal", pageIndex: target.page, offsetPt: target.offsetPt },
          });
        continue;
      }
      // `url` is PDF.js's sanitized value; `unsafeUrl` is the raw string. We check the raw one too.
      const url = safeExternalUrl(a.url ?? a.unsafeUrl);
      if (url && safeExternalUrl(a.unsafeUrl ?? a.url))
        out.push({ rect, target: { kind: "external", url } });
    }
    return out;
  }

  async title(): Promise<string | undefined> {
    try {
      const meta = await this.#pdf.getMetadata();
      const title = (meta.info as { Title?: unknown }).Title;
      return typeof title === "string" && title.trim() ? title.trim() : undefined;
    } catch {
      return undefined;
    }
  }

  async author(): Promise<string | undefined> {
    try {
      const meta = await this.#pdf.getMetadata();
      const author = (meta.info as { Author?: unknown }).Author;
      return typeof author === "string" && author.trim() ? author.trim() : undefined;
    } catch {
      return undefined;
    }
  }

  releasePage(index: number): void {
    const page = this.#pages.get(index);
    void page?.then((p) => p.cleanup()).catch(() => {});
  }

  async destroy(): Promise<void> {
    this.#pages.clear();
    await this.#pdf.loadingTask.destroy();
  }
}

async function toBytes(source: ArrayBuffer | Uint8Array | string): Promise<Uint8Array> {
  if (typeof source === "string") {
    const response = await fetch(source);
    if (!response.ok)
      throw new ReaderError(
        "network",
        "We couldn't download this file.",
        `HTTP ${response.status}`,
      );
    return new Uint8Array(await response.arrayBuffer());
  }
  // PDF.js transfers the buffer to its worker; keep our own copy for hashing.
  return new Uint8Array(source instanceof Uint8Array ? source : new Uint8Array(source)).slice();
}

export const pdfJsEngine: ReaderEngine = {
  async open(source, opts: OpenOptions = {}): Promise<ReaderDocument> {
    const base = opts.assetBaseUrl ?? "/pdfjs/";
    const lib = await loadLib(base);
    const bytes = await toBytes(source);
    if (opts.signal?.aborted) throw abortError();
    const task = lib.getDocument({
      data: bytes.slice(),
      enableXfa: false,
      cMapUrl: `${base}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${base}standard_fonts/`,
      wasmUrl: `${base}wasm/`,
      iccUrl: `${base}iccs/`,
    });
    opts.signal?.addEventListener("abort", () => void task.destroy(), { once: true });
    let cancelled = false;
    task.onPassword = (update: (password: string) => void, reason: number) => {
      const request = opts.requestPassword;
      if (!request) {
        void task.destroy();
        return;
      }
      const why = reason === lib.PasswordResponses.INCORRECT_PASSWORD ? "incorrect" : "need";
      void request(why).then((password) => {
        if (password === null) {
          cancelled = true;
          void task.destroy();
          return;
        }
        update(password);
      });
    };
    try {
      const pdf = await task.promise;
      return new PdfJsDocument(lib, pdf, bytes);
    } catch (error) {
      if (opts.signal?.aborted) throw abortError();
      if (cancelled)
        throw new ReaderError("password-cancelled", "This file is password protected.");
      if (error instanceof lib.PasswordException) {
        throw new ReaderError(
          "password-cancelled",
          "This file is password protected.",
          error.message,
        );
      }
      throw toReaderError(lib, error);
    }
  },
};
