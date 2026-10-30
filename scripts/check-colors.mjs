// Fails when a hard-coded color literal appears outside the token files.
// Run by `pnpm lint` (and CI). Allowed: tokens.css, highlight palette/analysis, tests, scripts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const roots = ["apps/web/src", "packages/ui/src"];
const exts = /\.(tsx?|css|mdx?)$/;
const allowed = [
  /packages\/ui\/src\/styles\/tokens\.css$/,
  /packages\/ui\/src\/highlight\//,
  /packages\/ui\/src\/theme\/brand-colors\.ts$/,
  /\.test\.tsx?$/,
];
const literal =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(|\b(?:text|bg|border|fill|stroke|ring|from|to|via|outline|decoration|divide|shadow)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (exts.test(name)) yield p;
  }
}

export function findColorLiterals(root = ".") {
  const hits = [];
  for (const r of roots)
    for (const file of walk(join(root, r))) {
      const rel = relative(root, file).replaceAll("\\", "/");
      if (allowed.some((a) => a.test(rel))) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (literal.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
  return hits;
}

if (
  import.meta.url === `file://${process.argv[1].replaceAll("\\", "/")}` ||
  process.argv[1]?.endsWith("check-colors.mjs")
) {
  const hits = findColorLiterals();
  if (hits.length) {
    console.error(`Hard-coded colors outside the token files:\n${hits.join("\n")}`);
    process.exit(1);
  }
  console.log("check-colors: ok");
}
