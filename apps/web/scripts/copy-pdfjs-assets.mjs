// Copies the PDF.js worker and its static data (fonts, CMaps, wasm decoders, ICC profiles) from
// node_modules to public/pdfjs, where the reader loads them (ADR-0003). Output is git-ignored.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "../../../packages/reader/node_modules/pdfjs-dist");
const target = join(here, "../public/pdfjs");

if (!existsSync(source)) {
  console.error(`pdfjs-dist not found at ${source}. Run pnpm install first.`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(join(source, "build/pdf.worker.min.mjs"), join(target, "pdf.worker.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  cpSync(join(source, dir), join(target, dir), { recursive: true });
}
console.log("pdfjs assets copied to public/pdfjs");
