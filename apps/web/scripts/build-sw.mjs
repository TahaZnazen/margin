// Bundles sw/sw.ts (Serwist) into public/sw.js and writes public/offline-assets.json, the list of
// big static files (PowerSync workers + WASM, the PDF.js worker + WASM) that the app warms into the
// service worker's cache after the first visit. Output is git-ignored. Runs before `next build`.
import { createHash } from "node:crypto";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const publicDir = join(root, "public");

await build({
  entryPoints: [join(root, "sw/sw.ts")],
  outfile: join(publicDir, "sw.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: false,
  legalComments: "none",
});

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const url = (path) => `/${relative(publicDir, path).split("\\").join("/")}`;
const wanted = [
  ...files(join(publicDir, "@powersync")).filter((p) => !p.endsWith(".map")),
  join(publicDir, "pdfjs/pdf.worker.min.mjs"),
  ...files(join(publicDir, "pdfjs/wasm")).filter((p) => p.endsWith(".wasm")),
].map(url);
const version = createHash("sha1").update(wanted.join("|")).digest("hex").slice(0, 8);
writeFileSync(join(publicDir, "offline-assets.json"), JSON.stringify({ version, urls: wanted }));
console.log(`service worker built (${wanted.length} warm-up assets)`);
