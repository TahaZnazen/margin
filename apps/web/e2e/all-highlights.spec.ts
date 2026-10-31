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
  waitOfflineReady,
} from "./p12-helpers";

// N3: /app/highlights lists every highlight of every book (local SQLite), searchable and
// filterable, each one a click from its exact spot in the PDF.

test.describe.configure({ mode: "serial" });

const EVIDENCE = "../../evidence/n3-all-highlights";
const RULER_L1 = "Line one of the ruler paragraph begins exactly at x = 72 pt.";
const RULER_LAST = "This is the last line of the paragraph on the first ruler page.";
const MIXED_P1 = "Page 1 of 6: US Letter portrait, Rotate 0";
const MIXED_P1B = "Text is drawn in unrotated page space.";

let user: TestUser;
let rulerUrl = "";
let mixedUrl = "";

test.beforeAll(async () => {
  user = await createUser("hl");
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

const count = (page: Page, color: string) => page.getByTestId(`hl-count-${color}`);

test("lists every highlight of two books; search, color, book and sort; click opens and flashes", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, user);
  rulerUrl = await uploadAndSettle(page, "ruler");
  await openReady(page, rulerUrl);
  await highlight(page, RULER_L1, "1");
  await highlight(page, RULER_LAST, "3");
  await page.goto("/app");
  await expect(page.getByTestId("book")).toHaveCount(1);
  mixedUrl = await uploadAndSettle(page, "mixed-pages");
  await openReady(page, mixedUrl);
  await highlight(page, MIXED_P1, "1");
  await highlight(page, MIXED_P1B, "2");

  // Empty-state copy is covered below with a fresh user; here the list has four items.
  await page.goto("/app");
  await page.getByRole("link", { name: "Highlights" }).first().click();
  await expect(page).toHaveURL(/\/app\/highlights$/);
  await expect(page.getByTestId("hl-item")).toHaveCount(4);
  await expect(page.getByTestId("hl-total")).toHaveText("4 highlights");
  await page.screenshot({ path: `${EVIDENCE}/desktop-light.png`, fullPage: true });

  // Chip names and counts.
  await expect(page.getByRole("button", { name: "Key idea, 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Definition, 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Example, 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Memorize, 0" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confusing, 0" })).toBeVisible();

  // Search: quote text, case and accent insensitive; and the book title.
  await page.getByTestId("hl-search").fill("RULER PARAGRAPH");
  await expect(page.getByTestId("hl-item")).toHaveCount(1);
  await page.getByTestId("hl-search").fill("mixed page sizes");
  await expect(page.getByTestId("hl-item")).toHaveCount(2);
  await page.getByTestId("hl-search").fill("zzzz-nothing");
  await expect(page.getByTestId("hl-none")).toBeVisible();
  await page.getByTestId("hl-search").fill("");
  await expect(page.getByTestId("hl-item")).toHaveCount(4);

  // Color filter.
  await page.getByTestId("hl-filter-key").click();
  await expect(page.getByTestId("hl-item")).toHaveCount(2);
  await expect(page.getByTestId("hl-filter-key")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("hl-filter-example").click();
  await expect(page.getByTestId("hl-item")).toHaveCount(3);
  await page.getByTestId("hl-filter-key").click();
  await page.getByTestId("hl-filter-example").click();
  await expect(page.getByTestId("hl-item")).toHaveCount(4);

  // Book filter; chip counts follow it.
  const mixedOption = await page
    .getByTestId("hl-book-filter")
    .locator("option", { hasText: /mixed/i })
    .getAttribute("value");
  await page.getByTestId("hl-book-filter").selectOption({ value: mixedOption ?? "" });
  await expect(page.getByTestId("hl-item")).toHaveCount(2);
  await expect(count(page, "key")).toHaveText("1");
  await expect(count(page, "example")).toHaveText("0");
  await page.getByTestId("hl-book-filter").selectOption({ value: "" });
  await expect(page.getByTestId("hl-item")).toHaveCount(4);

  // Sorts: newest first = the last highlight made first; book order = by title, then page.
  const quotes = () => page.getByTestId("hl-quote").allTextContents();
  expect((await quotes())[0]).toBe(MIXED_P1B);
  await page.getByTestId("hl-sort").selectOption("book");
  const byBook = await quotes();
  // "Mixed page sizes..." sorts before "Ruler: ..."; within a book, document order.
  expect(byBook).toHaveLength(4);
  expect(byBook.slice(0, 2).sort()).toEqual([MIXED_P1, MIXED_P1B].sort());
  expect(byBook.slice(2)).toEqual([RULER_L1, RULER_LAST]);
  await page.getByTestId("hl-sort").selectOption("newest");

  // Keyboard: the first item is a tabbable link.
  await page.getByTestId("hl-item").first().getByRole("link").focus();
  await expect(page.getByTestId("hl-item").first().getByRole("link")).toBeFocused();

  // axe, light and dark.
  await audit(page, "highlights light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/(^| )dark( |$)/);
  await page.screenshot({ path: `${EVIDENCE}/desktop-dark.png`, fullPage: true });
  await audit(page, "highlights dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(/(^| )light( |$)/);

  // Click: opens the book at the highlight and it flashes.
  const item = page.getByTestId("hl-item").filter({ hasText: RULER_L1 });
  const annId = (await item.getAttribute("data-annotation-id")) ?? "";
  await item.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/app/read/[0-9a-f-]{36}#a=${annId}$`));
  const rect = page.locator(`.mr-annot[data-annotation-id="${annId}"]`).first();
  await expect(rect).toBeAttached({ timeout: 30_000 });
  await expect(rect).toHaveAttribute("data-flash", "true");
  await page.screenshot({ path: `${EVIDENCE}/click-flash.png` });

  // Phone: four nav items fit, no horizontal scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/highlights");
  await expect(page.getByTestId("hl-item")).toHaveCount(4);
  const bar = page.getByRole("navigation", { name: "Main (mobile)" });
  const links = bar.getByRole("link");
  await expect(links).toHaveCount(4);
  for (const box of await links.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, scrollW: el.scrollWidth, clientW: el.clientWidth };
    }),
  )) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(390);
    expect(box.scrollW).toBeLessThanOrEqual(box.clientW);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: `${EVIDENCE}/phone.png` });
  await audit(page, "highlights phone");
});

test("command palette: Go to Highlights, and typing searches all highlights outside a book", async ({
  page,
}) => {
  await signIn(page, user);
  await page.getByTestId("palette-button").click();
  await page.getByRole("combobox", { name: "Command" }).fill("go to highl");
  await page.getByRole("option", { name: /Go to Highlights/ }).click();
  await expect(page).toHaveURL(/\/app\/highlights$/);

  await page.getByTestId("palette-button").click();
  await page.getByRole("combobox", { name: "Command" }).fill("RULER paragraph begins");
  const hits = page.getByTestId("palette-highlight");
  await expect(hits).toHaveCount(1);
  await page.screenshot({ path: `${EVIDENCE}/palette.png` });
  await hits.first().click();
  await expect(page).toHaveURL(/\/app\/read\/[0-9a-f-]{36}#a=[0-9a-f-]{36}$/);
  await expect(page.locator(".mr-annot[data-flash='true']").first()).toBeAttached({
    timeout: 30_000,
  });
});

test.describe("offline", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => localStorage.setItem("margin.e2e.pwa", "1"));
  });

  test("after one online visit the page and its filters work offline", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, user);
    await page.goto("/app/highlights");
    await expect(page.getByTestId("hl-item")).toHaveCount(4);
    await waitOfflineReady(page);
    await page.goto("/app/highlights"); // a navigation under the worker stores the page
    await expect(page.getByTestId("hl-item")).toHaveCount(4);
    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.getByTestId("hl-item")).toHaveCount(4, { timeout: 30_000 });
      await page.getByTestId("hl-filter-key").click();
      await expect(page.getByTestId("hl-item")).toHaveCount(2);
      await page.getByTestId("hl-filter-key").click();
      await page.getByTestId("hl-search").fill("ruler paragraph");
      await expect(page.getByTestId("hl-item")).toHaveCount(1);
      await page.screenshot({ path: `${EVIDENCE}/offline.png` });
    } finally {
      await context.setOffline(false);
    }
  });
});

test("a highlight made in another context appears without reload; deleted ones and deleted books vanish", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    await signIn(a, user);
    await signIn(b, user);
    await b.goto("/app/highlights");
    await expect(b.getByTestId("hl-item")).toHaveCount(4);

    // New highlight in A (second of the ruler lines, memorize).
    await openReady(a, rulerUrl);
    await highlight(a, "Every line in this block uses 11 pt Helvetica with 15 pt leading.", "4");
    await expect(b.getByTestId("hl-item")).toHaveCount(5, { timeout: 45_000 });
    await expect(b.getByRole("button", { name: "Memorize, 1" })).toBeVisible();

    // Delete that highlight in A: it leaves B's list.
    const id = await a.evaluate(async () => {
      const list = await window.__margin
        ?.services()
        .annotations.list(location.pathname.split("/").pop() ?? "");
      return list?.find((x) => x.color === "memorize")?.id ?? "";
    });
    expect(id).not.toBe("");
    await a.evaluate((x) => window.__margin?.services().annotations.remove(x), id);
    await expect(b.getByTestId("hl-item")).toHaveCount(4, { timeout: 45_000 });
    await expect(b.locator(`[data-annotation-id="${id}"]`)).toHaveCount(0);

    // Delete the mixed-pages book: its two highlights leave the list, and the book filter drops it.
    const mixedId = mixedUrl.split("/").pop() ?? "";
    await a.evaluate((x) => window.__margin?.services().documents.softDelete(x), mixedId);
    await expect(b.getByTestId("hl-item")).toHaveCount(2, { timeout: 45_000 });
    await expect(b.getByTestId("hl-book-filter").locator("option")).toHaveCount(2);
    await b.screenshot({ path: `${EVIDENCE}/after-deletes.png` });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("a new user sees the empty state", async ({ browser }) => {
  const other = await createUser("hl-empty");
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await signIn(page, other);
    await page.goto("/app/highlights");
    await expect(page.getByTestId("hl-empty")).toHaveText(
      "No highlights yet — select text in a book and press 1–5.",
    );
    await audit(page, "highlights empty");
  } finally {
    await ctx.close();
    await deleteUser(other);
  }
});
