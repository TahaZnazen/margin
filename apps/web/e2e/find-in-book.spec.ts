import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createUser, deleteUser, signIn, type TestUser, uploadAndSettle } from "./p12-helpers";

// Q1: find in this book. Ctrl/Cmd+F, search as you type, "n of m", Enter / Shift+Enter, Esc,
// palette entry, phone layout, the `?` sheet, named color chips.

test.describe.configure({ mode: "serial" });

const EVIDENCE = "../../evidence/q1-find-in-book";
let user: TestUser;
const urls = { paper: "", french: "", arabic: "" };

test.beforeAll(async () => {
  mkdirSync(EVIDENCE, { recursive: true });
  user = await createUser("find");
});
test.afterAll(async () => {
  await deleteUser(user);
});

const bar = (page: Page) => page.getByTestId("find-bar");
const input = (page: Page) => page.getByTestId("find-input");
const count = (page: Page) => page.getByTestId("find-count");
const indicator = (page: Page) => page.getByTestId("page-indicator");

async function open(page: Page, url: string, signedIn = false) {
  if (!signedIn) await signIn(page, user);
  await page.goto(url);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await expect(indicator(page)).toBeVisible();
}

async function settled(page: Page) {
  await expect(count(page)).toHaveAttribute("data-searching", "false", { timeout: 30_000 });
}

async function audit(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    bad.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    `axe on ${name}`,
  ).toEqual([]);
}

test("setup: upload the books", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, user);
  urls.paper = await uploadAndSettle(page, "two-column-paper");
  urls.french = await uploadAndSettle(page, "french-accents-ligatures");
  urls.arabic = await uploadAndSettle(page, "arabic-rtl");
  // uploadAndSettle only watches the first tray card: wait for all three to be in storage.
  await expect(page.getByTestId("upload-item")).toHaveCount(3);
  await expect(page.locator('[data-testid="upload-item"]:not([data-stage="done"])')).toHaveCount(
    0,
    {
      timeout: 60_000,
    },
  );
});

test("Ctrl+F opens the bar; a known sentence is found, scrolled to and highlighted; n of m steps", async ({
  page,
}) => {
  await open(page, urls.paper);
  await expect(bar(page)).toHaveCount(0);
  await page.locator(".mr-scroller").focus();
  await page.keyboard.press("Control+f");
  await expect(bar(page)).toBeVisible();
  await expect(input(page)).toBeFocused();

  // manifest knownText, two-column-paper page index 1
  await page.keyboard.type("many-body wavefunction takes the form");
  await expect(count(page)).toHaveText(/^1 of \d+$/);
  await expect(indicator(page)).toHaveText("2 / 9");
  const current = page.locator(".mr-hit-current").first();
  await expect(current).toBeVisible();
  const box = await current.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.y >= 0 && box.y + box.height <= viewport.height).toBe(true);
  await page.screenshot({ path: `${EVIDENCE}/desktop-found.png` });

  // A broader query: Enter / Shift+Enter walk the hits and wrap.
  await input(page).fill("wavefunction");
  await settled(page);
  const n = Number(/of (\d+)/.exec((await count(page).textContent()) ?? "")?.[1]);
  expect(n).toBeGreaterThan(1);
  await expect(count(page)).toHaveText(`1 of ${n}`);
  await page.keyboard.press("Enter");
  await expect(count(page)).toHaveText(`2 of ${n}`);
  await page.keyboard.press("Shift+Enter");
  await expect(count(page)).toHaveText(`1 of ${n}`);
  await page.keyboard.press("Shift+Enter");
  await expect(count(page)).toHaveText(`${n} of ${n}`);
  await page.keyboard.press("Enter");
  await expect(count(page)).toHaveText(`1 of ${n}`);

  // No match.
  await input(page).fill("qqzzxxnotinthebook");
  await expect(count(page)).toHaveText("No matches");

  // Esc closes the bar and clears the hits.
  await input(page).fill("wavefunction");
  await expect(page.locator(".mr-hit").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator(".mr-hit")).toHaveCount(0);
});

test("a second Ctrl+F in the box is left to the browser", async ({ page }) => {
  await open(page, urls.paper);
  await page.locator(".mr-scroller").focus();
  await page.keyboard.press("Control+f");
  await expect(input(page)).toBeFocused();
  await page.evaluate(() => {
    const w = window as unknown as { __ctrlF: boolean[] };
    w.__ctrlF = [];
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "f") w.__ctrlF.push(e.defaultPrevented);
    });
  });
  await page.keyboard.press("Control+f");
  const seen = await page.evaluate(() => (window as unknown as { __ctrlF: boolean[] }).__ctrlF);
  expect(seen).toEqual([false]);
});

test("hits on later pages are found without visiting them; a new query replaces the old search; accents fold", async ({
  page,
}) => {
  await open(page, urls.french);
  await expect(indicator(page)).toContainText("1 / 94");
  await page.getByTestId("find-toggle").click();
  await expect(input(page)).toBeFocused();
  // Typed without the accent: the manifest line on page index 9 reads "molécules pendant un intervalle".
  await input(page).fill("molecules pendant un intervalle");
  await expect(count(page)).toHaveText(/^1 of \d+$/);
  await expect(indicator(page)).toContainText("10 / 94");
  await expect(page.locator(".mr-hit-current").first()).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/desktop-french.png` });

  // A broad query, then at once another one: only the second one's hits are counted.
  await input(page).fill("e");
  await input(page).fill("molecules pendant un intervalle de temps");
  await settled(page);
  await expect(count(page)).toHaveText(/^1 of [1-9]\d?$/);
  await expect(input(page)).toHaveValue("molecules pendant un intervalle de temps");
});

test("works in the Arabic fixture (right to left)", async ({ page }) => {
  await open(page, urls.arabic);
  await page.locator(".mr-scroller").focus();
  await page.keyboard.press("Control+f");
  await input(page).fill("أينشتاين");
  await expect(count(page)).toHaveText(/^1 of \d+$/);
  await expect(page.locator(".mr-hit-current").first()).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/desktop-arabic.png` });
});

test("command palette: Find in book opens the bar prefilled", async ({ page }) => {
  await open(page, urls.paper);
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("find wavefunction");
  await expect(page.getByRole("option", { name: /Find .wavefunction. in book/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(bar(page)).toBeVisible();
  await expect(input(page)).toHaveValue("wavefunction");
  await expect(count(page)).toHaveText(/^1 of \d+$/);

  // The bare entry opens an empty bar.
  await page.keyboard.press("Escape");
  await expect(bar(page)).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("find");
  await page.getByRole("option", { name: /Find in book/ }).click();
  await expect(bar(page)).toBeVisible();
  await expect(input(page)).toHaveValue("");
});

test("the ? sheet lists Ctrl/Cmd+F; the color chips have names", async ({ page }) => {
  await open(page, urls.paper);
  await page.locator(".mr-scroller").focus();
  await page.keyboard.press("?");
  const sheet = page.getByTestId("shortcut-sheet");
  await expect(sheet.getByText("Find in this book")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("panel-toggle").click();
  await expect(page.getByTestId("filter-key")).toHaveAccessibleName(/^[A-Za-z ]+, \d+$/);
  await expect(page.getByRole("button", { name: "Key idea, 0" })).toBeVisible();
});

test("axe clean with the bar open (desktop); phone layout", async ({ page }) => {
  await open(page, urls.paper);
  await page.getByTestId("find-toggle").click();
  await input(page).fill("wavefunction");
  await expect(count(page)).toHaveText(/^1 of \d+$/);
  await audit(page, "reader with find bar, desktop");
  await page.screenshot({ path: `${EVIDENCE}/desktop-bar.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, urls.paper, true);
  await expect(bar(page)).toHaveCount(0);
  await page.getByTestId("find-toggle").click();
  await expect(bar(page)).toBeVisible();
  const box = await bar(page).boundingBox();
  expect(box?.width).toBeGreaterThan(360);
  await input(page).fill("wavefunction");
  await expect(count(page)).toHaveText(/^1 of \d+$/);
  await expect(page.getByRole("button", { name: "Next match" })).toBeVisible();
  await audit(page, "reader with find bar, phone");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${EVIDENCE}/phone-bar.png` });
});
