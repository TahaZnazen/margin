// Playwright's web server: a clean production build in its own distDir, then `next start`.
// Isolated from `.next`, so a running `pnpm dev` or an earlier build can never leak old code into E2E.
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const port = process.argv[2] ?? "3100";
const appDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = ".next-e2e";
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
// The E2E build turns on flagged features under test (src/config/flags.ts).
const env = { ...process.env, NEXT_DIST_DIR: distDir, NEXT_PUBLIC_MARGIN_FLAGS: "chapterProgress" };

rmSync(`${appDir}${distDir}`, { recursive: true, force: true });

const run = (args) => {
  const result = spawnSync(process.execPath, args, { cwd: appDir, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run([fileURLToPath(new URL("./copy-pdfjs-assets.mjs", import.meta.url))]);
run([fileURLToPath(new URL("./copy-powersync-assets.mjs", import.meta.url))]);
run([fileURLToPath(new URL("./build-sw.mjs", import.meta.url))]);
run([nextBin, "build"]);

const server = spawn(process.execPath, [nextBin, "start", "--port", port], {
  cwd: appDir,
  env,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
