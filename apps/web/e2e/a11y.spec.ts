import AxeBuilder from "@axe-core/playwright";
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

// P12: axe on the main screens in light and dark (no serious or critical violations), and a
// keyboard-only walkthrough: open a book, navigate, highlight with a key, write a note.

test.describe.configure({ mode: "serial" });

let user: TestUser;
let bookUrl = "";

test.beforeAll(async () => {
  user = await createUser("a11y");
});
test.afterAll(async () => {
  await deleteUser(user);
});

async function audit(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = bad.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n${v.nodes
        .slice(0, 4)
        .map((n) => `   ${n.target.join(" ")}  ${n.failureSummary?.split("\n")[1] ?? ""}`)
        .join("\n")}`,
  );
  expect(summary, `axe violations on ${name}`).toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test("sign-in", async ({ page }) => {
      await page.goto("/sign-in");
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
      await audit(page, `sign-in ${scheme}`);
    });

    test("library, reader, notes and settings", async ({ page }) => {
      test.setTimeout(180_000);
      await signIn(page, user);
      if (scheme === "light") bookUrl = await uploadAndSettle(page, "ruler");
      else await expect(page.getByTestId("book")).toHaveCount(1, { timeout: 30_000 });
      await expect(page.getByTestId("book")).toHaveCount(1);
      await audit(page, `library ${scheme}`);

      await page.goto(bookUrl);
      await expect(page.locator(".mr-canvas").first()).toBeVisible();
      await expect(page.locator(".mr-textlayer > span").first()).toBeAttached();
      await selectText(page, 0, RULER_LINE);
      await page.keyboard.press("2");
      await expect(page.getByTestId("highlight-rect")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await page.getByTestId("panel-toggle").click();
      await expect(page.getByTestId("right-panel")).toBeVisible();
      await page.getByTestId("sidebar-toggle").click();
      await expect(page.getByTestId("reader-rail")).toBeVisible();
      await audit(page, `reader ${scheme}`);

      await page.goto("/app/notes");
      await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
      await audit(page, `notes ${scheme}`);

      await page.goto("/app/settings");
      await expect(page.getByTestId("storage-section")).toBeVisible();
      await expect(page.getByLabel("key", { exact: true })).toBeEnabled({ timeout: 15_000 });
      await audit(page, `settings ${scheme}`);
    });
  });
}

test("keyboard only: open a book, move around, highlight with a key, write a note", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, user);
  await expect(page.getByTestId("book")).toHaveCount(1, { timeout: 30_000 });

  // Library: reach the book's link by keyboard and open it.
  const open = page.getByRole("link", { name: /^Open / });
  await open.focus();
  await expect(open).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/read\/[0-9a-f-]{36}$/);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await expect(page.locator(".mr-textlayer > span").first()).toBeAttached();

  // Navigate with keys only.
  await page.locator(".mr-scroller").focus();
  const indicator = page.getByTestId("page-indicator");
  await page.keyboard.press("End");
  await expect(indicator).toContainText("2 / 2");
  await page.keyboard.press("Home");
  await expect(indicator).toContainText("1 / 2");
  await page.keyboard.press("PageDown");
  await expect(indicator).toContainText("2 / 2");
  await page.keyboard.press("g");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Command" })).toBeFocused();
  await page.keyboard.type("1");
  await page.keyboard.press("Enter");
  await expect(indicator).toContainText("1 / 2");
  await page.keyboard.press("o"); // contents sidebar
  await expect(page.getByTestId("reader-rail")).toBeVisible();
  await page.keyboard.press("o");
  await expect(page.getByTestId("reader-rail")).toHaveCount(0);

  // A selection made with the keyboard's selection API, then keys: color 1, then a note.
  await page.locator(".mr-scroller").focus();
  await selectText(page, 0, RULER_LINE);
  await page.keyboard.press("1");
  await expect(page.getByTestId("highlight-rect")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await selectText(page, 0, "Every line in this block uses 11 pt Helvetica with 15 pt leading.");
  await page.keyboard.press("n");
  await expect(page.getByTestId("comment-input")).toBeFocused();
  await page.keyboard.type("keyboard note");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("comment-marker")).toBeVisible();

  // Shortcut help by key, then back out through the palette.
  await page.locator(".mr-scroller").focus();
  await page.keyboard.press("Shift+?");
  await expect(page.getByTestId("shortcut-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("notes");
  await page
    .getByRole("option", { name: /^Notes/ })
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/notes$/);
});
