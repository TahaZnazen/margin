// @ts-check
/**
 * `pnpm fixtures`: makes every file in manifest.json present and verified.
 *
 * - Downloaded entries are fetched when missing or when their sha256 does not match.
 * - Generated entries that are missing (the git-ignored size-cap files) are rebuilt with generate.mjs.
 * - Every file is checked against its sha256 and size. Re-running with everything in place
 *   only re-hashes: no network, no writes.
 *
 * Downloaded PDFs are untrusted data. They are written as bytes into downloads/ and nothing in
 * them is ever executed or parsed here.
 *
 * Flags:
 *   --only=<id>[,<id>…]  limit to these manifest ids
 *   --skip-large         skip entries of 40 MB or more (the textbook, the 161 MB atlas, the size-cap files)
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{ kind: "download"; url: string } | { kind: "generated" }} Source
 * @typedef {{ id: string; file: string; sha256: string; bytes: number; source: Source }} Entry
 */

const PDFS_DIR = dirname(fileURLToPath(import.meta.url));
const LARGE_BYTES = 40_000_000;
const ATTEMPTS = 3;
const IDLE_TIMEOUT_MS = 60_000;
const USER_AGENT = "margin-fixtures/1.0 (golden PDF corpus downloader; Node.js)";

/** @param {string} file */
async function hashFile(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

/** Resolves an entry's file and refuses anything that escapes fixtures/pdfs. @param {Entry} entry */
function targetPath(entry) {
  const target = resolve(PDFS_DIR, entry.file);
  if (!target.startsWith(PDFS_DIR + sep)) throw new Error(`${entry.id}: file path escapes fixtures/pdfs: ${entry.file}`);
  return target;
}

/** @param {string} file @param {Entry} entry */
async function isVerified(file, entry) {
  if (!existsSync(file) || statSync(file).size !== entry.bytes) return false;
  return (await hashFile(file)) === entry.sha256;
}

/** @param {number} n */
const mb = (n) => `${(n / 1_000_000).toFixed(1)} MB`;

/**
 * Streams the URL into `<target>.part` while hashing, then renames it into place once the size
 * and sha256 match. @param {Entry & { source: { kind: "download"; url: string } }} entry @param {string} target
 */
async function download(entry, target) {
  const part = `${target}.part`;
  mkdirSync(dirname(target), { recursive: true });
  const controller = new AbortController();
  /** @type {NodeJS.Timeout | undefined} */
  let idle;
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(new Error(`no data for ${IDLE_TIMEOUT_MS / 1000} s`)), IDLE_TIMEOUT_MS);
  };
  try {
    resetIdle();
    const response = await fetch(entry.source.url, {
      headers: { "user-agent": USER_AGENT },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const hash = createHash("sha256");
    let received = 0;
    let nextReport = 0.1;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        resetIdle();
        hash.update(chunk);
        received += chunk.length;
        if (entry.bytes > 10_000_000 && received / entry.bytes >= nextReport) {
          process.stdout.write(`  ${entry.id}: ${Math.round((received / entry.bytes) * 100)}%\n`);
          nextReport += 0.1;
        }
        if (received > entry.bytes) callback(new Error(`more than the expected ${entry.bytes} bytes`));
        else callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(/** @type {import("node:stream/web").ReadableStream} */ (response.body)), meter, createWriteStream(part));
    const digest = hash.digest("hex");
    if (received !== entry.bytes) throw new Error(`got ${received} bytes, expected ${entry.bytes}`);
    if (digest !== entry.sha256) throw new Error(`sha256 ${digest} does not match the manifest (${entry.sha256})`);
    renameSync(part, target);
  } finally {
    clearTimeout(idle);
    rmSync(part, { force: true });
  }
}

/** @param {Entry} entry @param {string} target */
async function generate(entry, target) {
  const { buildGenerated, generatedSpec } = await import("./generate.mjs");
  const { bytes, entry: built } = await buildGenerated(generatedSpec(entry.id));
  if (built.sha256 !== entry.sha256 || bytes.length !== entry.bytes) {
    throw new Error(
      `generator output (sha256 ${built.sha256}, ${bytes.length} bytes) does not match the manifest. Run \`pnpm --filter @margin/fixtures generate\` and commit the result.`,
    );
  }
  mkdirSync(dirname(target), { recursive: true });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(target, bytes);
}

/** @param {Entry} entry */
async function ensure(entry) {
  const target = targetPath(entry);
  const name = relative(PDFS_DIR, target).split(sep).join("/");
  if (await isVerified(target, entry)) return { status: "ok", detail: name };
  const existed = existsSync(target);
  if (existed) rmSync(target);
  const source = entry.source;
  if (source.kind === "generated") {
    await generate(entry, target);
    return { status: existed ? "regenerated" : "generated", detail: `${name} (${mb(entry.bytes)})` };
  }
  /** @type {unknown} */
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      console.log(`  ${entry.id}: downloading ${mb(entry.bytes)} from ${new URL(source.url).host} (attempt ${attempt})`);
      await download({ ...entry, source }, target);
      return { status: existed ? "re-downloaded" : "downloaded", detail: `${name} (${mb(entry.bytes)})` };
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastError;
}

async function main() {
  /** @type {{ entries: Entry[] }} */
  const manifest = JSON.parse(readFileSync(join(PDFS_DIR, "manifest.json"), "utf8"));
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",")) : null;
  const skipLarge = process.argv.includes("--skip-large");
  if (only) {
    const unknown = [...only].filter((id) => !manifest.entries.some((e) => e.id === id));
    if (unknown.length) throw new Error(`Unknown fixture id(s): ${unknown.join(", ")}`);
  }

  const started = Date.now();
  let failures = 0;
  let changed = 0;
  for (const entry of manifest.entries) {
    if (only && !only.has(entry.id)) continue;
    if (skipLarge && entry.bytes >= LARGE_BYTES) {
      console.log(`skip         ${entry.id} (${mb(entry.bytes)}, --skip-large)`);
      continue;
    }
    try {
      const { status, detail } = await ensure(entry);
      if (status !== "ok") changed++;
      console.log(`${status.padEnd(12)} ${entry.id.padEnd(26)} ${detail}`);
    } catch (error) {
      failures++;
      console.error(`FAILED       ${entry.id.padEnd(26)} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    failures
      ? `\n${failures} fixture(s) failed. Fix the source or record the gap in manifest.json.`
      : `\nAll fixtures verified in ${seconds} s (${changed === 0 ? "nothing to do" : `${changed} fetched or generated`}).`,
  );
  if (failures) process.exitCode = 1;
}

await main();
