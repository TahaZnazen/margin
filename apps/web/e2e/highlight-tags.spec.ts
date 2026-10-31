import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  createUser,
  deleteUser,
  selectText,
  signIn,
  type TestUser,
  uploadAndSettle,
} from "./p12-helpers";

// N5: topic tags on highlights, set in the popover, shown in the panel and on /app/highlights,
// filterable in both, synced, undoable.

test.describe.configure({ mode: "serial" });

const EVIDENCE = "../../evidence/n5-highlight-tags";
const RULER_L1 = "Line one of the ruler paragraph begins exactly at x = 72 pt.";
const RULER_LAST = "This is the last line of the paragraph on the first ruler page.";

let user: TestUser;
let rulerUrl = "";

test.beforeAll(async () => {
  user = await createUser("tags");
  mkdirSync(EVIDENCE, { recursive: true });
});
test.afterAll(async () => {
  await deleteUser(user);
});

async function openReady(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await expect(page.locator(".mr-textlayer > span").first()).toBeAttached();
}

async function highlight(page: Page, text: string, key: string) {
  const before = await page.getByTestId("highlight-rect").count();
  await selectText(page, 0, text);
  await page.keyboard.press(key);
  await expect(page.getByTestId("highlight-rect")).not.toHaveCount(before);
  await expect(page.getByTestId("pending-writes")).toHaveText("0", { timeout: 15_000 });
}

async function openHighlight(page: Page, color: string) {
  const rect = page.locator(`.mr-annot[data-color="${color}"]`).first();
  await rect.scrollIntoViewIfNeeded();
  const box = await rect.boundingBox();
  if (!box) throw new Error(`no ${color} highlight`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("annotation-popover")).toHaveAttribute("data-mode", "edit");
}

async function audit(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    `axe on ${name}`,
  ).toEqual([]);
}

async function openPanel(page: Page) {
  if (!(await page.getByTestId("right-panel").isVisible())) {
    await page.getByTestId("panel-toggle").click();
  }
  await page.getByTestId("tab-annotations").click();
}

test("tags: add in the popover, undo and redo, panel and page filters, reload, second context", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await signIn(page, user);
  rulerUrl = await uploadAndSettle(page, "ruler");
  await openReady(page, rulerUrl);
  await highlight(page, RULER_L1, "1");
  await highlight(page, RULER_LAST, "3");

  // Open the first (key) highlight; # focuses the tag field.
  await openHighlight(page, "key");
  await page.keyboard.press("#");
  const input = page.getByTestId("tag-input");
  await expect(input).toBeFocused();

  // Typing never triggers reader shortcuts: t (theme), digits (recolor), n, j/k, b.
  const htmlClass = await page.locator("html").getAttribute("class");
  await input.pressSequentially("t1njkb");
  await expect(input).toHaveValue("t1njkb");
  expect(await page.locator("html").getAttribute("class")).toBe(htmlClass);
  await expect(page.locator('.mr-annot[data-color="key"]')).not.toHaveCount(0);
  await input.fill("");

  // Normalization on entry: Enter adds, comma adds, case/spaces/# are cleaned.
  await input.pressSequentially("#Renal System");
  await input.press("Enter");
  await expect(page.getByTestId("tag-chip")).toHaveText(["#renal-system"]);
  await input.pressSequentially("Exam-2,");
  await expect(page.getByTestId("tag-chip")).toHaveText(["#renal-system", "#exam-2"]);
  await expect(input).toHaveValue("");
  await expect(page.getByTestId("tag-remove").first()).toHaveAccessibleName(
    "Remove tag renal-system",
  );
  await page.screenshot({ path: `${EVIDENCE}/popover-desktop.png` });
  await audit(page, "reader with tag popover");

  // Undo / redo: one step per tag. (Escape leaves the field and closes the popover.)
  await input.press("Escape");
  await page.keyboard.press("Control+z");
  await openHighlight(page, "key");
  await expect(page.getByTestId("tag-chip")).toHaveText(["#renal-system"]);
  await page.keyboard.press("Control+z");
  await openHighlight(page, "key");
  await expect(page.getByTestId("tag-chip")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("Control+Shift+z");
  await openHighlight(page, "key");
  await expect(page.getByTestId("tag-chip")).toHaveText(["#renal-system", "#exam-2"]);

  // Remove with the x button, then add it back by typing.
  await page.getByRole("button", { name: "Remove tag exam-2" }).click();
  await expect(page.getByTestId("tag-chip")).toHaveText(["#renal-system"]);
  await page.getByTestId("tag-input").fill("exam 2");
  await page.getByTestId("tag-input").press("Enter");
  await expect(page.getByTestId("tag-chip")).toHaveText(["#renal-system", "#exam-2"]);

  // Second highlight: the suggestion list offers this book's tags.
  await page.getByTestId("tag-input").press("Escape");
  await openHighlight(page, "example");
  await page.keyboard.press("#");
  await page.getByTestId("tag-input").pressSequentially("ren");
  await page.getByRole("button", { name: "Add tag renal-system" }).click();
  await expect(page.getByTestId("tag-chip")).toHaveText(["#renal-system"]);
  await page.getByTestId("tag-input").press("Escape");
  await expect(page.getByTestId("pending-writes")).toHaveText("0", { timeout: 15_000 });

  // Panel: tags on the items, filter chips with counts and accessible names.
  await openPanel(page);
  await expect(page.getByTestId("annot-item")).toHaveCount(2);
  await expect(page.getByTestId("annot-tag")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Tag renal-system, 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tag exam-2, 1" })).toBeVisible();
  await page.getByTestId("tag-filter-exam-2").click();
  await expect(page.getByTestId("tag-filter-exam-2")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("annot-item")).toHaveCount(1);
  await expect(page.getByTestId("annot-quote")).toHaveText(RULER_L1);
  await expect(page.getByRole("button", { name: "Tag renal-system, 1" })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/panel-desktop.png` });
  await page.getByTestId("tag-filter-exam-2").click();
  await expect(page.getByTestId("annot-item")).toHaveCount(2);
  await page.getByTestId("annot-search").fill("exam-2");
  await expect(page.getByTestId("annot-item")).toHaveCount(1);
  await page.getByTestId("annot-search").fill("");
  await audit(page, "reader panel with tags");

  // Persists after a reload.
  await page.reload();
  await expect(page.getByTestId("highlight-rect").first()).toBeVisible();
  await openHighlight(page, "key");
  await expect(page.getByTestId("tag-chip")).toHaveText(["#renal-system", "#exam-2"]);

  // All-highlights page: chips on items, tag filter, tag search.
  await page.goto("/app/highlights");
  await expect(page.getByTestId("hl-item")).toHaveCount(2);
  await expect(page.getByTestId("hl-tag")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Tag renal-system, 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tag exam-2, 1" })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/highlights-desktop.png`, fullPage: true });
  await page.getByTestId("hl-tag-filter-exam-2").click();
  await expect(page.getByTestId("hl-item")).toHaveCount(1);
  await expect(page.getByTestId("hl-total")).toHaveText("1 highlight");
  await expect(page.getByTestId("hl-quote")).toHaveText(RULER_L1);
  await page.getByTestId("hl-tag-filter-exam-2").click();
  await expect(page.getByTestId("hl-item")).toHaveCount(2);
  await page.getByTestId("hl-search").fill("exam-2");
  await expect(page.getByTestId("hl-item")).toHaveCount(1);
  await page.getByTestId("hl-search").fill("");
  await audit(page, "highlights page with tags");

  // Phone.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("hl-tag-filters")).toBeVisible();
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${EVIDENCE}/highlights-phone.png`, fullPage: true });
  await openReady(page, rulerUrl);
  await openHighlight(page, "key");
  await page.getByTestId("tag-input").focus();
  await page.screenshot({ path: `${EVIDENCE}/popover-phone.png` });
  await page.setViewportSize({ width: 1280, height: 800 });

  // A second browser context signed in as the same user sees the tags (synced).
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await signIn(other, user);
  await other.goto("/app/highlights");
  await expect(other.getByTestId("hl-tag")).toHaveCount(3, { timeout: 60_000 });
  await other.getByTestId("hl-tag-filter-exam-2").click();
  await expect(other.getByTestId("hl-item")).toHaveCount(1);
  await ctx.close();
});
