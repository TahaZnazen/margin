// Adds shadcn/ui components to this package, then rewrites their imports to the package's own
// subpath imports (#components/*, #lib/*, #hooks/*).
//
// Why: the shadcn CLI mis-resolves the scoped `@margin/ui/...` aliases on Windows, so
// components.json uses `@/...` (CLI only). `@/` means apps/web/src everywhere else in the repo,
// so it must never survive in this package's source.
//
// Usage: pnpm --filter @margin/ui ui:add <component...>
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

if (args.length > 0) {
  // The pinned devDependency, so generated code matches the shadcn/tailwind.css we import.
  const result = spawnSync("pnpm", ["exec", "shadcn", "add", ...args], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const rewrites = [
  [/from "cn"/g, 'from "#lib/utils"'],
  [/from "@\/lib\/utils"/g, 'from "#lib/utils"'],
  [/from "@\/components\/([\w-]+)"/g, 'from "#components/$1"'],
  [/from "@\/hooks\/([\w-]+)"/g, 'from "#hooks/$1"'],
  [/from "@\/lib\/([\w-]+)"/g, 'from "#lib/$1"'],
];

const dir = join(root, "src", "components");
let changed = 0;
for (const name of readdirSync(dir)) {
  if (!name.endsWith(".tsx")) continue;
  const file = join(dir, name);
  const before = readFileSync(file, "utf8");
  let after = before;
  for (const [pattern, replacement] of rewrites) after = after.replace(pattern, replacement);
  if (after !== before) {
    writeFileSync(file, after);
    changed++;
  }
}
console.log(`Rewrote imports in ${changed} file(s). The CLI may add packages to package.json:`);
console.log("check them (cn and next-themes are known false positives) and run pnpm format.");
