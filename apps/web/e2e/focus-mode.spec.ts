import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  createUser,
  deleteUser,
  RULER_LINE,
  selectText,
  signIn,
  type TestUser,
  uploadAndSettle,
} from "./p12-helpers";

// Q4: F hides everything but the page; the top edge (or a tap) shows the header for 2.5 s; Esc leaves.

test.describe.configure({ mode: "serial" });

const EVIDENCE = "../../evidence/q4-focus-mode";
let user: TestUser;
let url = "";

test.beforeAll(async () => {
  mkdirSync(EVIDENCE, { recursive: true });
  user = await createUser("focus");
});
test.afterAll(async () => {
  await deleteUser(user);
});

const header = (page: Page) => page.getByTestId("reader-header");
const inFocus = (page: Page) => page.getByTestId("focus-toggle");

async function openBook(page: Page) {
  await signIn(page, user);
  await page.goto(url);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await page.locator(".mr-scroller").focus();
}

test("setup: upload the ruler book", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, user);
  url = await uploadAndSettle(page, "ruler");
});

test("F enters, the top edge shows the header for a moment, Esc leaves", async ({ page }) => {
  test.setTimeout(120_000);
  await openBook(page);
  // Open both sides first so focus mode has something to hide.
  await page.keyboard.press("o");
  await page.keyboard.press("p");
  await expect(page.getByTestId("reader-rail")).toBeVisible();
  await expect(page.getByTestId("right-panel")).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/desktop-normal.png` });

  await page.keyboard.press("f");
  await expect(header(page)).toHaveAttribute("data-hidden", "true");
  await expect(page.getByTestId("reader-rail")).toBeHidden();
  await expect(page.getByTestId("right-panel")).toBeHidden();
  await page.screenshot({ path: `${EVIDENCE}/desktop-focus.png` });

  // Pointer at the top edge: the header comes back, then goes away again.
  await page.mouse.move(600, 300);
  await page.mouse.move(600, 2);
  await expect(header(page)).not.toHaveAttribute("data-hidden", "true");
  await page.screenshot({ path: `${EVIDENCE}/desktop-peek.png` });
  await page.mouse.move(600, 300);
  await expect(header(page)).toHaveAttribute("data-hidden", "true", { timeout: 6_000 });

  await page.keyboard.press("Escape");
  await expect(header(page)).not.toHaveAttribute("data-hidden", "true");
  await expect(page.getByTestId("reader-rail")).toBeVisible();
  await expect(page.getByTestId("right-panel")).toBeVisible();
  // F again toggles back in; the header button (peeked) toggles out.
  await page.keyboard.press("f");
  await expect(header(page)).toHaveAttribute("data-hidden", "true");
  await page.mouse.move(600, 2);
  await expect(inFocus(page)).toHaveAttribute("aria-pressed", "true");
  await inFocus(page).click();
  await expect(header(page)).not.toHaveAttribute("data-hidden", "true");
  await expect(inFocus(page)).toHaveAttribute("aria-pressed", "false");
});

test("highlighting, keys 1-5 and undo still work in focus mode", async ({ page }) => {
  test.setTimeout(120_000);
  await openBook(page);
  await page.keyboard.press("f");
  await expect(header(page)).toHaveAttribute("data-hidden", "true");
  await selectText(page, 0, RULER_LINE);
  await page.keyboard.press("3");
  await expect(page.getByTestId("highlight-rect")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("highlight-rect")).toHaveCount(0);
  // Esc with a selection popover open closes the popover first and stays in focus mode.
  await selectText(page, 0, RULER_LINE);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("annotation-popover")).toHaveCount(0);
  await expect(header(page)).toHaveAttribute("data-hidden", "true");
  await page.keyboard.press("Escape"); // nothing nearer: leaves
  await expect(header(page)).not.toHaveAttribute("data-hidden", "true");
});

test("F is ignored while typing; Esc closes find before leaving; palette and ? list it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openBook(page);
  await page.keyboard.press("ControlOrMeta+f");
  const find = page.getByTestId("find-input");
  await expect(find).toBeFocused();
  await page.keyboard.type("ff");
  await expect(find).toHaveValue("ff");
  await expect(header(page)).not.toHaveAttribute("data-hidden", "true");
  await page.keyboard.press("Escape");
  await expect(find).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Command" }).fill("focus mode");
  await page.getByRole("option", { name: /Focus mode/ }).click();
  await expect(header(page)).toHaveAttribute("data-hidden", "true");

  // Find open inside focus mode: first Esc closes find, second leaves.
  await page.locator(".mr-scroller").focus();
  await page.keyboard.press("/");
  await expect(find).toBeVisible();
  await page.locator(".mr-scroller").focus();
  await page.keyboard.press("Escape");
  await expect(find).toHaveCount(0);
  await expect(header(page)).toHaveAttribute("data-hidden", "true");
  await page.keyboard.press("Escape");
  await expect(header(page)).not.toHaveAttribute("data-hidden", "true");

  await page.locator(".mr-scroller").focus();
  await page.keyboard.press("Shift+?");
  await expect(page.getByTestId("shortcut-sheet")).toContainText("Focus mode");
  await page.keyboard.press("Escape");
});

test("a rejected or missing Fullscreen API never breaks focus mode", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new TypeError("not allowed"));
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openBook(page);
  await page.keyboard.press("f");
  await expect(header(page)).toHaveAttribute("data-hidden", "true");
  await page.keyboard.press("Escape");
  await expect(header(page)).not.toHaveAttribute("data-hidden", "true");
  expect(errors).toEqual([]);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the header button enters; a tap shows the header, which leaves again", async ({ page }) => {
    test.setTimeout(120_000);
    await openBook(page);
    await page.screenshot({ path: `${EVIDENCE}/phone-normal.png` });
    await inFocus(page).tap();
    await expect(header(page)).toHaveAttribute("data-hidden", "true");
    await page.screenshot({ path: `${EVIDENCE}/phone-focus.png` });
    await page.locator(".mr-scroller").tap({ position: { x: 190, y: 400 } });
    await expect(header(page)).not.toHaveAttribute("data-hidden", "true");
    await page.screenshot({ path: `${EVIDENCE}/phone-peek.png` });
    await inFocus(page).tap();
    await expect(inFocus(page)).toHaveAttribute("aria-pressed", "false");
    await expect(header(page)).not.toHaveAttribute("data-hidden", "true");
    // Header controls stay inside the viewport.
    const box = await inFocus(page).boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  });
});
