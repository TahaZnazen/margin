import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { admin, createUser, deleteUser, signIn, type TestUser } from "./p12-helpers";

// N4: shelves. Create, rename, delete with undo, add/remove books, filter, remember, second
// device, offline, remove + re-add (unique constraint), palette, axe, screenshots.

const EVIDENCE = "../../evidence/n4-shelves";
mkdirSync(EVIDENCE, { recursive: true });

test.describe.configure({ mode: "serial" });

let user: TestUser;
const docs = [
  { id: randomUUID(), title: "Alpha Pharmacology" },
  { id: randomUUID(), title: "Beta Physiology" },
  { id: randomUUID(), title: "Gamma Anatomy" },
] as const;

test.beforeAll(async () => {
  user = await createUser("shelves");
  for (const d of docs) {
    const { error } = await admin.from("documents").insert({
      id: d.id,
      user_id: user.id,
      title: d.title,
      sha256: randomUUID().replaceAll("-", "").repeat(2),
      read_status: "readable",
    });
    if (error) throw new Error(error.message);
  }
});
test.afterAll(async () => {
  await deleteUser(user);
});

const synced = (page: Page) =>
  expect(page.getByTestId("sync-status")).toHaveAttribute("data-state", "synced", {
    timeout: 20_000,
  });

async function open(browser: Browser): Promise<[BrowserContext, Page]> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, user);
  await synced(page);
  await expect(page.getByTestId("book")).toHaveCount(3);
  return [ctx, page];
}

const chip = (page: Page, name: string) => page.getByTestId("shelf-chip").filter({ hasText: name });
const titles = (page: Page) => page.getByTestId("book-title");

async function serverLinks() {
  const { data, error } = await admin
    .from("collection_documents")
    .select("id, collection_id, document_id, deleted_at")
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
  return data ?? [];
}
const serverShelves = async () => {
  const { data } = await admin
    .from("collections")
    .select("id, name, deleted_at")
    .eq("user_id", user.id);
  return data ?? [];
};

async function syncErrors(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const { db } = (
      window as unknown as { __margin: { db: () => import("@powersync/web").PowerSyncDatabase } }
    ).__margin;
    const rows = await db().getAll<{ n: number }>("SELECT COUNT(*) AS n FROM sync_errors");
    return rows[0]?.n ?? 0;
  });
}

async function shelvesDialog(page: Page, title: string) {
  await page.getByRole("button", { name: `Menu for ${title}` }).click();
  await page.getByRole("menuitem", { name: "Shelves…" }).click();
  return page.getByTestId("book-shelves-dialog");
}

test("create, add books, filter, count, remember, rename", async ({ browser }) => {
  test.setTimeout(90_000);
  const [ctx, page] = await open(browser);

  await page.getByTestId("new-shelf").click();
  await page.getByLabel("Shelf name").fill("Pharmacology");
  await page.getByRole("button", { name: "Create shelf" }).click();
  await expect(chip(page, "Pharmacology")).toContainText("0");
  await chip(page, "Pharmacology").click();
  await expect(page.getByTestId("no-matches")).toContainText("empty");
  await chip(page, "All books").click();

  for (const d of [docs[0], docs[1]]) {
    const dialog = await shelvesDialog(page, d.title);
    await dialog.getByRole("checkbox", { name: "Pharmacology" }).check();
    await page.keyboard.press("Escape");
  }
  await expect(chip(page, "Pharmacology")).toContainText("2");
  await chip(page, "Pharmacology").click();
  await expect
    .poll(async () => (await titles(page).allTextContents()).sort())
    .toEqual(["Alpha Pharmacology", "Beta Physiology"]);
  await chip(page, "All books").click();

  // The book dialog can also make a new shelf and put the book on it.
  const dialog = await shelvesDialog(page, "Gamma Anatomy");
  await dialog.getByLabel("New shelf name").fill("Exam 2");
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Exam 2" })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(chip(page, "Exam 2")).toContainText("1");

  await chip(page, "All books").click();
  await expect(chip(page, "All books")).toContainText("3");
  await expect(titles(page)).toHaveCount(3);

  await chip(page, "Exam 2").click();
  await expect(titles(page)).toHaveText(["Gamma Anatomy"]);
  await page.reload();
  await expect(chip(page, "Exam 2")).toHaveAttribute("aria-pressed", "true");
  await expect(titles(page)).toHaveText(["Gamma Anatomy"]);

  await page.getByRole("button", { name: "Menu for shelf Exam 2" }).click();
  await page.getByRole("menuitem", { name: "Rename shelf" }).click();
  await page.getByLabel("Shelf name").fill("Exam 3");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(chip(page, "Exam 3")).toBeVisible();
  await expect(chip(page, "Exam 2")).toHaveCount(0);

  await synced(page);
  await expect
    .poll(async () => (await serverShelves()).map((s) => s.name).sort(), { timeout: 15_000 })
    .toEqual(["Exam 3", "Pharmacology"]);
  expect(await syncErrors(page)).toBe(0);
  await ctx.close();
});

test("delete keeps the books; undo restores the shelf with its books", async ({ browser }) => {
  test.setTimeout(60_000);
  const [ctx, page] = await open(browser);
  await chip(page, "Pharmacology").click();
  await page.getByRole("button", { name: "Menu for shelf Pharmacology" }).click();
  await page.getByRole("menuitem", { name: "Delete shelf" }).click();
  await expect(chip(page, "Pharmacology")).toHaveCount(0);
  await expect(chip(page, "All books")).toHaveAttribute("aria-pressed", "true");
  await expect(titles(page)).toHaveCount(3);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(chip(page, "Pharmacology")).toContainText("2");
  await chip(page, "Pharmacology").click();
  await expect
    .poll(async () => (await titles(page).allTextContents()).sort())
    .toEqual(["Alpha Pharmacology", "Beta Physiology"]);
  await synced(page);
  await expect
    .poll(async () => (await serverLinks()).filter((l) => l.deleted_at === null).length, {
      timeout: 15_000,
    })
    .toBe(3);
  expect(await syncErrors(page)).toBe(0);
  await ctx.close();
});

test("remove and re-add the same book: one server row, no sync error", async ({ browser }) => {
  test.setTimeout(60_000);
  const [ctx, page] = await open(browser);
  const shelf = (await serverShelves()).find((s) => s.name === "Pharmacology");
  const doc = docs[0];
  if (!shelf) throw new Error("setup");
  for (let i = 0; i < 2; i++) {
    const dialog = await shelvesDialog(page, doc.title);
    await dialog.getByRole("checkbox", { name: "Pharmacology" }).uncheck();
    await synced(page);
    await dialog.getByRole("checkbox", { name: "Pharmacology" }).check();
    await synced(page);
    await page.keyboard.press("Escape");
  }
  const pair = async () =>
    (await serverLinks()).filter((l) => l.document_id === doc.id && l.collection_id === shelf.id);
  await expect.poll(async () => (await pair()).filter((l) => !l.deleted_at).length).toBe(1);
  expect(await pair()).toHaveLength(1);
  expect(await syncErrors(page)).toBe(0);
  await expect(page.getByTestId("sync-status")).not.toHaveAttribute("data-state", "error");
  await ctx.close();
});

test("a second device sees changes live; offline changes sync after reconnect", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const [ctxA, a] = await open(browser);
  const [ctxB, b] = await open(browser);

  await a.getByTestId("new-shelf").click();
  await a.getByLabel("Shelf name").fill("Live shelf");
  await a.getByRole("button", { name: "Create shelf" }).click();
  await expect(chip(b, "Live shelf")).toBeVisible({ timeout: 10_000 });

  // Offline on B: add a book to the shelf, then reconnect.
  await ctxB.setOffline(true);
  await expect(b.getByTestId("sync-status")).toHaveAttribute("data-state", "offline");
  const dialog = await shelvesDialog(b, "Beta Physiology");
  await dialog.getByRole("checkbox", { name: "Live shelf" }).check();
  await b.keyboard.press("Escape");
  await expect(chip(b, "Live shelf")).toContainText("1");
  await expect(chip(a, "Live shelf")).toContainText("0");
  await ctxB.setOffline(false);
  await synced(b);
  await expect(chip(a, "Live shelf")).toContainText("1", { timeout: 15_000 });
  expect(await syncErrors(a)).toBe(0);
  expect(await syncErrors(b)).toBe(0);
  await ctxA.close();
  await ctxB.close();
});

test("command palette: Go to shelf", async ({ browser }) => {
  test.setTimeout(60_000);
  const [ctx, page] = await open(browser);
  await chip(page, "All books").click();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("shelf Pharm");
  await page.getByTestId("palette-shelf").filter({ hasText: "Pharmacology" }).click();
  await expect(chip(page, "Pharmacology")).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => (await titles(page).allTextContents()).sort())
    .toEqual(["Alpha Pharmacology", "Beta Physiology"]);
  await ctx.close();
});

test("axe clean, screenshots on desktop and phone, export still works", async ({ browser }) => {
  test.setTimeout(90_000);
  const [ctx, page] = await open(browser);
  await chip(page, "Pharmacology").click();
  const audit = async (name: string) => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(
      bad.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
      `axe on ${name}`,
    ).toEqual([]);
  };
  await audit("library with shelves");
  await page.screenshot({ path: `${EVIDENCE}/library-desktop.png` });
  const dialog = await shelvesDialog(page, "Alpha Pharmacology");
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(500); // the dialog fades in; axe must not sample mid-fade
  await audit("book shelves dialog");
  await page.screenshot({ path: `${EVIDENCE}/dialog-desktop.png` });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("shelf-bar")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, "no horizontal page scroll at 390 px").toBe(false);
  await page.screenshot({ path: `${EVIDENCE}/library-phone.png` });

  // Export everything still produces a zip.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app/settings");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByTestId("export-everything").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  await ctx.close();
});
