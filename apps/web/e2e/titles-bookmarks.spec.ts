import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createUser, deleteUser, signIn, type TestUser, uploadAndSettle } from "./p12-helpers";

// Q3: a PDF without Title metadata gets its biggest first-page line as the title; bookmarks show
// their chapter and can be renamed (undoable, survives reload, used by the Markdown export);
// the settings label fields show the swatch and default name.

test.describe.configure({ mode: "serial" });

const EVIDENCE = "../../evidence/q3-titles-bookmarks";
let user: TestUser;
let paperUrl = "";

test.beforeAll(async () => {
  mkdirSync(EVIDENCE, { recursive: true });
  user = await createUser("titles");
});
test.afterAll(async () => {
  await deleteUser(user);
});

test("titles: no metadata uses the biggest line; real metadata is kept", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, user);
  paperUrl = await uploadAndSettle(page, "two-column-paper");
  await uploadAndSettle(page, "annotations");
  const titles = page.getByTestId("book").getByTestId("book-title");
  await expect(titles).toHaveCount(2);
  await expect(
    titles.filter({ hasText: "Area-law entanglement from quantum geometry" }),
  ).toHaveCount(1);
  await expect(titles.filter({ hasText: "Margin existing annotations fixture" })).toHaveCount(1);
  await expect(titles.filter({ hasText: "arxiv-2210" })).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE}/library-titles.png` });
});

test("bookmarks show the chapter, rename inline (undo, reload) and export by name", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, user);
  await page.goto(`${paperUrl}#p=2`);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await expect(page.getByTestId("page-indicator")).toHaveText("2 / 9");
  await page.getByTestId("sidebar-toggle").click();
  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await page.getByTestId("reader-sidebar").click({ position: { x: 5, y: 300 } }); // not an input
  await page.keyboard.press("b");
  const item = page.getByTestId("bookmark-item");
  await expect(item).toHaveCount(1);
  await expect(page.getByTestId("bookmark-title")).toHaveText(
    /Simple two-particle example · p\. 2$/,
  );
  await page.screenshot({ path: `${EVIDENCE}/bookmark-chapter.png` });

  // Rename inline.
  await page.getByTestId("bookmark-rename").click();
  const input = page.getByTestId("bookmark-name-input");
  await input.fill("Definition of the metric");
  await input.press("Enter");
  await expect(page.getByTestId("bookmark-title")).toHaveText("Definition of the metric");
  await expect(page.getByTestId("bookmark-where")).toHaveText(
    /Simple two-particle example · p\. 2$/,
  );
  await page.screenshot({ path: `${EVIDENCE}/bookmark-renamed.png` });

  // Undo takes the name back (focus on the page, not the sidebar button).
  await page
    .locator(".mr-page")
    .first()
    .click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("bookmark-title")).toHaveText(
    /Simple two-particle example · p\. 2$/,
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.getByTestId("bookmark-title")).toHaveText("Definition of the metric");

  // Survives a reload (local-first write reaches SQLite before the reload).
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  const sidebarOpen = await page.getByTestId("reader-sidebar").isVisible();
  if (!sidebarOpen) await page.getByTestId("sidebar-toggle").click();
  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await expect(page.getByTestId("bookmark-title")).toHaveText("Definition of the metric");

  // Markdown export uses the name.
  await page.getByTestId("export-menu").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-markdown").click();
  const path = join(EVIDENCE, "export.md");
  await (await download).saveAs(path);
  expect(readFileSync(path, "utf8")).toMatch(/^- \*\*Definition of the metric\*\* · p\. 2 · \[/m);
});

test("settings: label fields show the swatch and the default name", async ({ page }) => {
  await signIn(page, user);
  await page.goto("/app/settings");
  await expect(page.getByTestId("label-swatch")).toHaveCount(5);
  await expect(page.getByText("Key idea", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("key", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Key idea")).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/settings-labels.png` });
});
