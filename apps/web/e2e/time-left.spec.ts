import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { createUser, deleteUser, signIn, type TestUser, uploadAndSettle } from "./p12-helpers";

// Q2: library card shows "p. N of M · X % · about Y min left"; chapter rows show their first page,
// the current one shows time left; nothing shows for a book never read.

test.describe.configure({ mode: "serial" });

const EVIDENCE = "../../evidence/q2-time-left";
let user: TestUser;
const urls = { paper: "", french: "" };

test.beforeAll(async () => {
  mkdirSync(EVIDENCE, { recursive: true });
  user = await createUser("timeleft");
});
test.afterAll(async () => {
  await deleteUser(user);
});

const indicator = (page: Page) => page.getByTestId("page-indicator");

test("setup: upload the books", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, user);
  urls.paper = await uploadAndSettle(page, "two-column-paper");
  urls.french = await uploadAndSettle(page, "french-accents-ligatures");
  await expect(page.getByTestId("upload-item")).toHaveCount(2);
});

test("reading a few pages shows page, percent and time left in the library; unread books show nothing", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, user);
  // Fake timers must exist before the reader starts its one-second reading timer.
  await page.clock.install();
  await page.goto(urls.paper);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await page.getByTestId("sidebar-toggle").click();
  await expect(page.getByTestId("chapter-row").first()).toBeVisible();
  // Before any reading data: page numbers show, time left does not.
  await expect(page.getByTestId("chapter-time-left")).toHaveCount(0);

  for (const p of [2, 3, 4, 5]) {
    await page.evaluate((n) => {
      window.location.hash = `#p=${n}`;
    }, p);
    await expect(indicator(page)).toHaveText(`${p} / 9`);
    // 40 active seconds per page, in steps that keep the reader "active".
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(100 + i, 100 + p);
      await page.clock.runFor(5_000);
    }
  }
  await page.clock.runFor(20_000); // pace refresh
  await page.clock.resume(); // real time again, so the debounced saves of the last position fire
  await page.waitForTimeout(2_500);
  await expect(page.getByTestId("chapter-time-left").first()).toBeVisible();
  await expect(page.getByTestId("chapter-time-left").first()).toHaveText(/(min|h) left/);

  // Sidebar page numbers match the palette's chapter list.
  const rows = await page.getByTestId("chapter-row").evaluateAll((els) =>
    els.map((el) => ({
      page: el.getAttribute("data-page"),
      shown: el.querySelector('[data-testid="chapter-page"]')?.textContent?.trim(),
    })),
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) expect(r.shown).toBe(`p. ${r.page}`);
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog");
  const paletteCaptions = await palette
    .locator('[cmdk-group][data-value="Chapters"] [cmdk-item] [cmdk-shortcut], [cmdk-item]')
    .allTextContents();
  const paletteShortcuts = paletteCaptions.flatMap((t) => t.match(/p\. \d+$/) ?? []);
  expect(paletteShortcuts).toEqual(expect.arrayContaining(rows.map((r) => `p. ${r.page}`)));
  await page.keyboard.press("Escape");

  await page.screenshot({ path: `${EVIDENCE}/sidebar.png` });
  await expect(page.getByTestId("chapter-time-left-header")).toBeAttached();

  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page).toHaveURL(/\/app$/);
  const paper = page.locator('[data-testid="book"]', { hasText: "" }).filter({
    has: page.getByTestId("book-progress"),
  });
  await expect(paper).toHaveCount(1, { timeout: 30_000 });
  // (The saved page is the one at the top of the viewport, so it may trail the indicator by one.)
  await expect(paper.getByTestId("book-progress")).toHaveText(
    /^p\. [45] of 9 · \d+ % · (about \d+ (min|h) left|under 1 min left)$/,
  );
  await expect(paper.getByRole("progressbar", { name: "Reading progress" })).toBeVisible();
  // The other book was opened at upload but never read: no progress line.
  await expect(page.getByTestId("book")).toHaveCount(2);
  await expect(page.getByTestId("book-progress")).toHaveCount(1);
  await page.screenshot({ path: `${EVIDENCE}/library.png` });
});
