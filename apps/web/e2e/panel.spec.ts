import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// P10: annotations panel, notebook, backlinks and /app/notes, against the dev Supabase project.

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

const email = `e2e-panel-${randomUUID()}@example.com`;
const password = `pw-${randomUUID()}`;
let userId = "";
let bookUrl = "";
const EVIDENCE = "../../evidence/p10-p11";

const L1 = "Line one of the ruler paragraph begins exactly at x = 72 pt.";
const L2 = "Every line in this block uses 11 pt Helvetica with 15 pt leading.";
const L3 = "Highlights that span several lines must stay aligned at any zoom.";

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

async function openBook(page: Page) {
  await page.goto(bookUrl);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await expect(page.getByTestId("highlight-rect").first()).toBeVisible();
}

async function openPanel(page: Page, tab: "annotations" | "notebook") {
  if (!(await page.getByTestId("right-panel").isVisible())) {
    await page.getByTestId("panel-toggle").click();
  }
  await page.getByTestId(`tab-${tab}`).click();
}

async function second(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page);
  return { ctx, page };
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

test("panel lists highlights, filters by color and text, click jumps and flashes", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.getByTestId("upload-input").setInputFiles(pdf("ruler"));
  await expect(page).toHaveURL(/\/app\/read\/[0-9a-f-]{36}$/);
  bookUrl = page.url();
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await expect(page.locator(".mr-textlayer > span").first()).toBeAttached();

  await selectText(page, L1);
  await page.keyboard.press("1");
  await selectText(page, L2);
  await page.keyboard.press("3");
  await selectText(page, L3);
  await page.keyboard.press("1");
  await expect(page.getByTestId("highlight-rect")).toHaveCount(3);
  await expect(page.getByTestId("pending-writes")).toHaveText("0", { timeout: 15_000 });

  await page.keyboard.press("p");
  await expect(page.getByTestId("right-panel")).toBeVisible();
  await expect(page.getByTestId("annot-item")).toHaveCount(3);
  await expect(page.getByTestId("count-key")).toHaveText("2");
  await expect(page.getByTestId("count-example")).toHaveText("1");
  await expect(page.getByTestId("count-memorize")).toHaveText("0");

  await page.getByTestId("filter-key").click();
  await expect(page.getByTestId("annot-item")).toHaveCount(2);
  await page.getByTestId("filter-key").click();
  await page.getByTestId("annot-search").fill("helvetica");
  await expect(page.getByTestId("annot-item")).toHaveCount(1);
  await expect(page.getByTestId("annot-quote")).toContainText("Helvetica");
  await page.getByTestId("annot-search").fill("");

  // Hover outlines it on the page; click jumps and flashes.
  const first = page.getByTestId("annot-item").first();
  const id = (await first.getAttribute("data-annotation-id")) ?? "";
  await first.hover();
  await expect(page.locator(`.mr-annot[data-annotation-id="${id}"]`).first()).toHaveAttribute(
    "data-active",
    "true",
  );
  await first.click();
  await expect(
    page.locator(`.mr-annot[data-annotation-id="${id}"][data-flash="true"]`).first(),
  ).toBeAttached();
  await page.screenshot({ path: `${EVIDENCE}/reader-annotations-panel.png` });

  // Later tests open the book in fresh browsers: wait until the upload is readable server-side.
  await expect
    .poll(
      async () => {
        const { data } = await admin.from("documents").select("read_status").eq("user_id", userId);
        return data?.[0]?.read_status;
      },
      { timeout: 30_000 },
    )
    .toBe("readable");
});

test("add to notebook, reload keeps the link, deleting the highlight degrades it, a second context sees it", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await openBook(page);
  await openPanel(page, "annotations");
  const item = page.getByTestId("annot-item").filter({ hasText: "Helvetica" });
  const id = (await item.getAttribute("data-annotation-id")) ?? "";
  await item.getByTestId("add-to-notebook").click();
  await expect(item.getByTestId("in-notebook")).toBeVisible();

  await page.getByTestId("tab-notebook").click();
  await expect(page.getByTestId("note-quote")).toHaveCount(1);
  await page.getByTestId("note-editor").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("My own thought about this.");
  await page.screenshot({ path: `${EVIDENCE}/reader-notebook-linked-quote.png` });

  // The row reaches the database (autosave 500 ms) with the derived plain text.
  const noteRows = () =>
    admin
      .from("notes")
      .select("document_id, plain_text")
      .eq("user_id", userId)
      .not("document_id", "is", null)
      .then((r) => r.data ?? []);
  await expect
    .poll(async () => (await noteRows())[0]?.plain_text ?? "")
    .toContain("My own thought");
  const rows = await noteRows();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.plain_text).toContain("Helvetica");

  await page.reload();
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await openPanel(page, "notebook");
  const quote = page.getByTestId("note-quote");
  await expect(quote).toHaveCount(1);
  await expect(quote).toHaveAttribute("data-state", "live");
  await expect(quote).toHaveAttribute("data-annotation-id", id);
  await expect(page.getByTestId("note-editor")).toContainText("My own thought");

  // Clicking the quote jumps and flashes the highlight.
  await quote.getByRole("button").click();
  await expect(
    page.locator(`.mr-annot[data-annotation-id="${id}"][data-flash="true"]`).first(),
  ).toBeAttached();

  // A second context sees the same notebook.
  const other = await second(browser);
  await openBook(other.page);
  await openPanel(other.page, "notebook");
  await expect(other.page.getByTestId("note-quote")).toHaveCount(1);
  await expect(other.page.getByTestId("note-editor")).toContainText("My own thought");
  await other.ctx.close();

  // Delete the highlight: the node degrades but keeps the snapshot.
  const rect = page.locator(`.mr-annot[data-annotation-id="${id}"]`).first();
  const box = await rect.boundingBox();
  if (!box) throw new Error("no highlight box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("popover-in-notebook")).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("note-quote")).toHaveAttribute("data-state", "deleted");
  await expect(page.getByTestId("quote-deleted")).toBeVisible();
  await expect(page.getByTestId("note-quote")).toContainText("Helvetica");
  await expect(page.getByTestId("pending-writes")).toHaveText("0", { timeout: 15_000 });

  await page.reload();
  await openPanel(page, "notebook");
  await expect(page.getByTestId("note-quote")).toHaveAttribute("data-state", "deleted");
});

test("/app/notes: create, rename, search and delete a standalone note", async ({ page }) => {
  await signIn(page);
  await page.goto("/app/notes");
  // The book notebook made above is listed.
  await expect(page.getByTestId("note-row").filter({ hasText: "My own thought" })).toHaveCount(1);

  await page.getByTestId("new-note").click();
  await page.getByTestId("note-title").fill("Reading plan");
  await page.getByTestId("note-editor").click();
  await page.keyboard.type("Zanzibar is the keyword.");
  await expect(page.getByTestId("note-pending")).toHaveText("0", { timeout: 15_000 });

  await page.reload();
  await page.getByTestId("notes-search").fill("zanzibar");
  const row = page.getByTestId("note-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Reading plan");
  await row.click();
  await expect(page.getByTestId("note-editor")).toContainText("Zanzibar");

  await page.getByTestId("delete-note").click();
  await expect(page.getByTestId("note-row")).toHaveCount(0);
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("notes")
        .select("id")
        .eq("user_id", userId)
        .is("document_id", null)
        .is("deleted_at", null);
      return data?.length;
    })
    .toBe(0);
  await page.reload();
  await page.getByTestId("notes-search").fill("zanzibar");
  await expect(page.getByTestId("notes-empty")).toBeVisible();
});
