// Copies the pre-bundled PowerSync workers (SQLite WASM + sync worker) from node_modules to
// public/@powersync, where the local database loads them (Turbopack can't bundle web workers
// yet). Output is git-ignored. Same as `powersync-web copy-assets -o public`, minus the CLI.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "../public/@powersync");
const require = createRequire(import.meta.url);
const source = dirname(require.resolve("@powersync/web/bundled_worker"));

if (!existsSync(source)) {
  console.error(`PowerSync workers not found at ${source}. Run pnpm install first.`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
