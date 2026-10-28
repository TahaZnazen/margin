import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// P08: upload, library and the reading route, against the dev Supabase project.

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "../../fixtures/pdfs/manifest.json"), "utf8"),
) as { pdfs?: { id: string; file: string }[]; entries?: { id: string; file: string }[] };
const entries = manifest.pdfs ?? manifest.entries ?? [];
const pdf = (id: string) => {
  const entry = entries.find((e) => e.id === id);
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

const email = `e2e-lib-${randomUUID()}@example.com`;
const password = `pw-${randomUUID()}`;
let userId = "";

async function storageObjects(): Promise<string[]> {
  const bucket = admin.storage.from("documents");
  const { data: folders } = await bucket.list(userId);
  const paths: string[] = [];
  for (const folder of folders ?? []) {
    const { data: files } = await bucket.list(`${userId}/${folder.name}`);
    for (const file of files ?? []) paths.push(`${userId}/${folder.name}/${file.name}`);
  }
  return paths;
}

async function rows(includeDeleted = false) {
  const { data } = await admin
    .from("documents")
    .select("id, title, read_status, deleted_at, cover_path, byte_size, page_count")
    .eq("user_id", userId);
  return (data ?? []).filter((r) => r.deleted_at === null || includeDeleted);
}

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

const scrollTop = (page: Page) =>
  page.locator(".mr-scroller").evaluate((el) => (el as HTMLElement).scrollTop);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  userId = data.user.id;
});

test.afterAll(async () => {
  if (!userId) return;
  const paths = await storageObjects();
  if (paths.length) await admin.storage.from("documents").remove(paths);
  await admin.auth.admin.deleteUser(userId);
});

let rulerId = "";
let paperId = "";
let paperScroll = 0;
let paperPage = "";

test("upload opens the book at once, then both books are stored and verified", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  await expect(page.getByTestId("empty-state")).toBeVisible();

  const t0 = Date.now();
  await page.getByTestId("upload-input").setInputFiles(pdf("ruler"));
  await expect(page).toHaveURL(/\/app\/read\/[0-9a-f-]{36}$/);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  const readableMs = Date.now() - t0;
  console.log(`READABLE_MS ruler (input set -> first page painted, from OPFS): ${readableMs}`);
  expect(readableMs).toBeLessThan(3000);
  rulerId = page.url().split("/").pop() ?? "";

  // Back to the library; the upload finishes in the background.
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page.getByTestId("book")).toHaveCount(1);
  await expect(page.getByTestId("upload-item").first()).toHaveAttribute("data-stage", "done", {
    timeout: 30_000,
  });
  const tDone = Date.now() - t0;
  console.log(`UPLOAD_DONE_MS ruler (input set -> verified readable on server): ${tDone}`);

  // Several files at once (one is a duplicate of the first).
  await page.getByTestId("upload-input").setInputFiles([pdf("two-column-paper"), pdf("ruler")]);
  await expect(page.getByTestId("book")).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByTestId("upload-item")).toHaveCount(3);
  for (const item of await page.getByTestId("upload-item").all()) {
    await expect(item).toHaveAttribute("data-stage", "done", { timeout: 40_000 });
  }

  // Server state: two readable rows, three objects per book pair (2 sources + 2 covers).
  const documents = await rows();
  expect(documents).toHaveLength(2);
  for (const doc of documents) {
    expect(doc.read_status).toBe("readable");
    expect(doc.byte_size).toBeGreaterThan(0);
    expect(doc.cover_path).toMatch(new RegExp(`^${userId}/${doc.id}/cover\\.webp$`));
  }
  paperId = documents.find((d) => d.id !== rulerId)?.id ?? "";
  expect((await storageObjects()).sort()).toHaveLength(4);

  await expect(page.locator("[data-testid=book] img")).toHaveCount(2);
  await page.screenshot({ path: "../../evidence/p08/library.png" });
});

test("a duplicate opens the existing book and uploads nothing", async ({ page }) => {
  await signIn(page);
  const before = (await storageObjects()).length;
  await page.getByTestId("upload-input").setInputFiles(pdf("ruler"));
  await expect(page.getByText("Already in your library")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/app/read/${rulerId}$`));
  expect(await rows()).toHaveLength(2);
  expect(await storageObjects()).toHaveLength(before);
});

test("rejects non-PDF, over-cap and corrupted files with clear messages", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  const input = page.getByTestId("upload-input");

  await input.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await expect(page.getByText(/"notes.txt" is not a PDF/)).toBeVisible();

  await input.setInputFiles(pdf("size-over-cap"));
  await expect(page.getByText(/larger than 50 MB/)).toBeVisible({ timeout: 30_000 });

  await input.setInputFiles(pdf("corrupted"));
  await expect(page.getByText(/looks corrupted/)).toBeVisible({ timeout: 20_000 });

  // The placeholder row of the corrupted upload is dropped just after the message appears.
  await expect.poll(async () => (await rows()).length).toBe(2);
  // The placeholder's insert and its delete are two local writes: let both reach the server before
  // the browser context closes (the poll above can pass before the insert has even landed).
  await expect
    .poll(() =>
      page.evaluate(async () => (await window.__margin?.db().getUploadQueueStats())?.count ?? 1),
    )
    .toBe(0);
});

test("reopen restores the position, and so does a second device", async ({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  await page.locator(`a[href="/app/read/${paperId}"]`).first().click();
  await expect(page.locator(".mr-canvas").first()).toBeVisible();

  await page.locator(".mr-scroller").hover();
  await page.mouse.wheel(0, 5200);
  await expect(page.getByTestId("page-indicator")).not.toHaveText(/^1 \//);
  paperPage = (await page.getByTestId("page-indicator").textContent()) ?? "";
  // Wait for the debounced save to reach the database.
  await expect
    .poll(async () => {
      const { data } = await admin
        .from("reading_state")
        .select("page, offset_pt, seconds_read")
        .eq("document_id", paperId)
        .maybeSingle();
      return data?.page ?? 0;
    })
    .toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  paperScroll = await scrollTop(page);
  const { data: saved } = await admin
    .from("reading_state")
    .select("page, offset_pt")
    .eq("document_id", paperId)
    .single();
  expect(saved?.page).toBeGreaterThan(0);

  // Close and reopen on the same device (OPFS).
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page.getByTestId("book")).toHaveCount(2);
  await page.locator(`a[href="/app/read/${paperId}"]`).first().click();
  await expect(page.getByTestId("page-indicator")).toHaveText(paperPage);
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
  expect(Math.abs((await scrollTop(page)) - paperScroll)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: "../../evidence/p08/reading.png" });

  // Another device: fresh browser context, no OPFS, downloads through a signed URL.
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signIn(page2);
  await page2.locator(`a[href="/app/read/${paperId}"]`).first().click();
  await expect(page2.getByTestId("page-indicator")).toHaveText(paperPage, { timeout: 30_000 });
  await expect.poll(() => scrollTop(page2)).toBeGreaterThan(0);
  expect(Math.abs((await scrollTop(page2)) - paperScroll)).toBeLessThanOrEqual(2);
  await other.close();
});

test("delete shows an undo toast and undo brings the book back", async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId("book")).toHaveCount(2);
  // The corrupted upload left one dropped placeholder row behind.
  const base = (await rows(true)).filter((r) => r.deleted_at).length;
  await page
    .getByRole("button", { name: /^Menu for/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByTestId("book")).toHaveCount(1);
  await expect
    .poll(async () => (await rows(true)).filter((r) => r.deleted_at).length)
    .toBe(base + 1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("book")).toHaveCount(2);
  await expect.poll(async () => (await rows(true)).filter((r) => r.deleted_at).length).toBe(base);

  // Rename through the menu.
  await page
    .getByRole("button", { name: /^Menu for/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Rename or edit author" }).click();
  await page.getByLabel("Author").fill("Ada Lovelace");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await page.getByLabel("Search library").fill("lovelace");
  await expect(page.getByTestId("book")).toHaveCount(1);
});
