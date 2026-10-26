// Proves the `server-only` guard: a Client Component that imports the admin client must fail `next build`.
// Adds a throwaway route, builds into a separate distDir (the real .next is untouched), then removes the route.
// If the script is ever killed mid-run, the leftover route shows up in `git status`; the next run removes it.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const probeDir = fileURLToPath(new URL("../src/app/server-only-probe/", import.meta.url));
const distDir = ".next-server-only-probe";
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

const probe = `"use client";
import { createAdminClient } from "@/lib/supabase/admin";

export default function ServerOnlyProbe() {
  return <pre>{typeof createAdminClient}</pre>;
}
`;

const expectedError = "'server-only' cannot be imported from a Client Component module";

// Keep Ctrl+C from killing this script before the probe is removed; the child build still stops.
process.on("SIGINT", () => {});

const cleanUp = () => {
  rmSync(probeDir, { recursive: true, force: true });
  rmSync(`${appDir}${distDir}`, { recursive: true, force: true });
};

cleanUp();
mkdirSync(probeDir, { recursive: true });
writeFileSync(`${probeDir}page.tsx`, probe);

let result;
try {
  result = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: appDir,
    encoding: "utf8",
    env: { ...process.env, NEXT_DIST_DIR: distDir, NO_COLOR: "1" },
  });
} finally {
  cleanUp();
}

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

if (result.status === 0) {
  console.error("FAIL: the build succeeded although a Client Component imports the admin client.");
  process.exit(1);
}
if (!output.includes(expectedError) || !output.includes("src/lib/supabase/admin.ts")) {
  console.error("FAIL: the build failed, but not because of the server-only guard:\n");
  console.error(output);
  process.exit(1);
}

console.log("PASS: importing the admin client from a Client Component fails the build:");
console.log(`  ${expectedError} (src/lib/supabase/admin.ts)`);
