import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Q5: copy with link (plain + HTML clipboard variants, #a= / #p= links), panel "Copy link".

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "../../fixtures/pdfs/manifest.json"), "utf8"),
) as { entries: { id: string; file: string }[] };
const pdf = (id: string) => {
  const entry = manifest.entries.find((e) => e.id === id);
  if (!entry) throw new Error(`no fixture ${id}`);
  return join(process.cwd(), "../../fixtures/pdfs", entry.file);
};

function readEnv(name: string): string {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const match = text.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, "");
  throw new Error(`${name} is not set`);
}

const admin = createClient(readEnv("NEXT_PUBLIC_SUPABASE_URL"), readEnv("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const email = `e2e-copylink-${randomUUID()}@example.com`;
const password = `pw-${randomUUID()}`;
let userId = "";
let bookUrl = "";
const EVIDENCE = "../../evidence/q5-copy-link";

const L1 = "Line one of the ruler paragraph begins exactly at x = 72 pt.";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function selectText(page: Page, text: string) {
  await page.evaluate((t) => {
    const spans = [
      ...document.querySelectorAll<HTMLElement>('.mr-page[data-page="0"] .mr-textlayer > span'),
    ];
    const span = spans.find((s) => s.textContent?.includes(t));
    if (!span) throw new Error(`no span for ${t}`);
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, text);
  await expect(page.getByTestId("annotation-popover")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  userId = data.user.id;
  mkdirSync(EVIDENCE, { recursive: true });
});

test.afterAll(async () => {
  if (!userId) return;
  const bucket = admin.storage.from("documents");
  const { data: folders } = await bucket.list(userId);
  const paths: string[] = [];
  for (const folder of folders ?? []) {
    const { data: files } = await bucket.list(`${userId}/${folder.name}`);
    for (const file of files ?? []) paths.push(`${userId}/${folder.name}/${file.name}`);
  }
  if (paths.length) await bucket.remove(paths);
  await admin.auth.admin.deleteUser(userId);
});

// Polls: the clipboard write is async, and reading mid-write throws "Clipboard data has changed".
const readClipboard = async (page: Page, until: RegExp) => {
  let out: Record<string, string> = {};
  await expect
    .poll(async () => {
      out = await readClipboardOnce(page).catch(() => ({}));
      return until.test(out["text/plain"] ?? "");
    })
    .toBe(true);
  return out;
};
const readClipboardOnce = (page: Page) =>
  page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    if (!item) throw new Error("clipboard empty");
    const out: Record<string, string> = {};
    for (const type of item.types) out[type] = await (await item.getType(type)).text();
    return out;
  });

test("copy with link: plain + HTML, #a= opens and flashes in a new context, panel Copy link, #p= for a selection", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const ctx1 = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx1.newPage();
  await signIn(page);
  await page.getByTestId("upload-input").setInputFiles(pdf("ruler"));
  await expect(page).toHaveURL(/\/app\/read\/[0-9a-f-]{36}$/);
  bookUrl = page.url();
  const docId = bookUrl.split("/").pop() ?? "";
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await expect(page.locator(".mr-textlayer > span").first()).toBeAttached();

  // Plain selection: copies a #p= link (page 1 -> #p=1).
  await selectText(page, L1);
  await page.getByTestId("popover-copy").click();
  await expect(page.getByText("Copied with link")).toBeVisible();
  const plainSel = await readClipboard(page, /#p=1/);
  expect(Object.keys(plainSel).sort()).toEqual(["text/html", "text/plain"]);
  expect(plainSel["text/plain"]).toContain(`"${L1}"`);
  expect(plainSel["text/plain"]).toContain(`
${new URL(bookUrl).origin}/app/read/${docId}#p=1`);
  expect(plainSel["text/html"]).toContain(
    `href="${new URL(bookUrl).origin}/app/read/${docId}#p=1"`,
  );

  // Saved highlight: copies #a=<id>.
  await page.keyboard.press("1");
  await expect(page.getByTestId("highlight-rect").first()).toBeVisible();
  await expect(page.getByTestId("pending-writes")).toHaveText("0", { timeout: 15_000 });
  // Selecting inside a saved highlight opens its edit popover.
  await selectText(page, L1);
  await page.getByTestId("popover-copy").click();
  const saved = await readClipboard(page, /#a=/);
  const m = /#a=([0-9a-f-]{36})/.exec(saved["text/plain"] ?? "");
  expect(m).not.toBeNull();
  const annId = m?.[1] ?? "";
  expect(saved["text/html"]).toContain(`#a=${annId}`);
  expect(saved["text/html"]).toContain("<blockquote>");

  // Panel: "Copy link" per highlight, and keep its a11y structure.
  await page.keyboard.press("p");
  const item = page.getByTestId("annot-item").first();
  await expect(item).toHaveAttribute("role", "group");
  await item.getByTestId("annot-copy-link").click();
  await expect(page.getByText("Link copied")).toBeVisible();
  const panelLink = await page.evaluate(() => navigator.clipboard.readText());
  expect(panelLink).toBe(`${new URL(bookUrl).origin}/app/read/${docId}#a=${annId}`);

  // A new context as the same user opens the link; the highlight flashes.
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await signIn(p2);
  await p2.goto(panelLink);
  const rect = p2.locator(`.mr-annot[data-annotation-id="${annId}"]`).first();
  await expect(rect).toBeAttached({ timeout: 30_000 });
  await expect(rect).toHaveAttribute("data-flash", "true");
  await p2.screenshot({ path: `${EVIDENCE}/q5-link-flash.png` });
  await ctx2.close();
  await ctx1.close();
});
