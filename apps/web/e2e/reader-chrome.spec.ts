import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  createUser,
  deleteUser,
  RULER_LINE,
  selectText,
  signIn,
  type TestUser,
} from "./p12-helpers";

// P12: command palette, shortcut sheet, zoom controls, auto-hiding top bar, upload tray polish.

test.describe.configure({ mode: "serial" });

let user: TestUser;
const ids = { chaptered: "", ruler: "" };

/** Four pages, no outline: large bold "Chapter N" headings on pages 1, 3 and 4. */
async function chapteredPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const body = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const titles = ["Chapter 1 The Beginning", null, "Chapter 2 The Middle", "Chapter 3 The End"];
  titles.forEach((title, n) => {
    const page = doc.addPage([420, 595]);
    if (title) page.drawText(title, { x: 40, y: 520, size: 26, font: bold });
    for (let i = 0; i < 30; i++) {
      page.drawText(`Run ${randomUUID().slice(0, 8)} of ordinary body text on page ${n + 1}.`, {
        x: 40,
        y: 480 - i * 14,
        size: 10,
        font: body,
      });
    }
  });
  return Buffer.from(await doc.save());
}

async function upload(page: Page, file: string | { name: string; buffer: Buffer }) {
  await page
    .getByTestId("upload-input")
    .setInputFiles(
      typeof file === "string"
        ? file
        : { name: file.name, mimeType: "application/pdf", buffer: file.buffer },
    );
  await expect(page).toHaveURL(/\/app\/read\/[0-9a-f-]{36}$/);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  const id = page.url().split("/").pop() ?? "";
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page.getByTestId("upload-item").last()).toHaveAttribute("data-stage", "done", {
    timeout: 40_000,
  });
  return id;
}

test.beforeAll(async () => {
  user = await createUser("chrome");
});
test.afterAll(async () => {
  await deleteUser(user);
});

test("setup: two books", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem("margin.trayDismissMs", "600000"));
  await signIn(page, user);
  const { pdf } = await import("./p12-helpers");
  ids.chaptered = await upload(page, {
    name: "Chaptered Handbook.pdf",
    buffer: await chapteredPdf(),
  });
  ids.ruler = await upload(page, pdf("ruler"));
  await expect(page.getByTestId("book")).toHaveCount(2);
});

test("command palette: open a book, go to a page, chapters, annotations, theme, panels, settings", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, user);
  await expect(page.getByTestId("book")).toHaveCount(2, { timeout: 30_000 });
  const palette = page.getByTestId("command-palette");

  // Open a book by (fuzzy) title.
  await page.keyboard.press("Control+k");
  await expect(palette).toBeVisible();
  await page.getByRole("combobox", { name: "Command" }).fill("chaptrd handbk");
  await expect(palette.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/app/read/${ids.chaptered}$`));
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await expect(page.getByTestId("page-indicator")).toContainText("1 / 4");

  // Go to page N.
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("3");
  await page.getByRole("option", { name: /Go to page 3/ }).click();
  await expect(page.getByTestId("page-indicator")).toContainText("3 / 4");

  // Jump to a chapter (detected from the large headings, a moment after opening).
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("the end");
  await expect(page.getByRole("option", { name: /Chapter 3 The End/ })).toBeVisible({
    timeout: 20_000,
  });
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("page-indicator")).toContainText("4 / 4");

  // Toggle theme, sidebar and panel.
  const themeBefore = await page.evaluate(() =>
    document.documentElement.getAttribute("data-theme-preference"),
  );
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("toggle theme");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme-preference")))
    .not.toBe(themeBefore);

  await expect(page.getByTestId("reader-rail")).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("contents sidebar");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("reader-rail")).toBeVisible();

  await expect(page.getByTestId("right-panel")).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("annotations panel");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("right-panel")).toBeVisible();

  // `g` opens the palette in go-to-page mode.
  await page.locator(".mr-scroller").focus();
  await page.keyboard.press("g");
  await expect(palette).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Command" })).toBeFocused();
  await page.keyboard.type("2");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("page-indicator")).toContainText("2 / 4");

  // Settings.
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("open settings");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/settings$/);
});

test("command palette searches highlights and notes of the open book", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, user);
  await page.goto(`/app/read/${ids.ruler}`);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await selectText(page, 0, RULER_LINE);
  await page.keyboard.press("3");
  await expect(page.getByTestId("highlight-rect")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector(".mr-scroller")?.scrollTo(0, 2000));
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("ruler paragraph");
  await page.getByRole("option", { name: /ruler paragraph/ }).click();
  await expect(page.getByTestId("page-indicator")).toContainText("1 / 2");
});

test("? opens the shortcut sheet with the keys from the layout spec", async ({ page }) => {
  await signIn(page, user);
  await page.goto(`/app/read/${ids.ruler}`);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await page.locator(".mr-scroller").focus();
  await page.keyboard.press("Shift+?");
  const sheet = page.getByTestId("shortcut-sheet");
  await expect(sheet).toBeVisible();
  for (const text of [
    "Command palette",
    "Go to page",
    "Zoom in / out / fit width",
    "Copy with citation",
  ]) {
    await expect(sheet).toContainText(text);
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
});

test("zoom controls: minus, percent, plus, fit width and fit page", async ({ page }) => {
  await signIn(page, user);
  await page.goto(`/app/read/${ids.ruler}`);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  const zoom = async () =>
    Number(await page.locator(".mr-viewer").getAttribute("data-zoom-percent"));
  const start = await zoom();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(zoom).toBeGreaterThan(start);
  await expect(page.getByTestId("zoom-percent")).toHaveText(`${Math.round(await zoom())}%`);
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect.poll(zoom).toBeLessThan(start);
  await page.getByRole("button", { name: "Fit width" }).click();
  await expect.poll(zoom).toBeCloseTo(start, 0);
  // Ctrl+wheel (also a trackpad pinch) still zooms.
  await page.locator(".mr-scroller").hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await expect.poll(zoom).toBeGreaterThan(start);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("zoom menu and a top bar that hides on scroll down and returns on scroll up", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, user);
    await page.goto(`/app/read/${ids.chaptered}`);
    await expect(page.locator(".mr-canvas").first()).toBeVisible();
    const header = page.getByTestId("reader-header");
    await expect(header).not.toHaveAttribute("data-hidden", "true");

    // Zoom from the compact menu.
    const zoom = async () =>
      Number(await page.locator(".mr-viewer").getAttribute("data-zoom-percent"));
    const start = await zoom();
    await page.getByTestId("zoom-menu").click();
    await page.getByTestId("zoom-popover").getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(zoom).toBeGreaterThan(start);
    await page.getByTestId("zoom-popover").getByRole("button", { name: "Fit width" }).click();
    await expect.poll(zoom).toBeCloseTo(start, 0);
    await page.keyboard.press("Escape");

    const scroll = (top: number) =>
      page.evaluate((t) => document.querySelector(".mr-scroller")?.scrollTo(0, t), top);
    await scroll(300);
    await scroll(700);
    await expect(header).toHaveAttribute("data-hidden", "true");
    // The reader's own state: the page keeps its place and the header is out of the layout.
    await scroll(500);
    await expect(header).not.toHaveAttribute("data-hidden", "true");
    await scroll(900);
    await scroll(1300);
    await expect(header).toHaveAttribute("data-hidden", "true");
    // A tap on the page brings it back.
    await page.touchscreen.tap(195, 400);
    await expect(header).not.toHaveAttribute("data-hidden", "true");
  });
});

test("upload tray: Saved cards clear themselves and the library keeps room for them", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem("margin.trayDismissMs", "2500"));
  await signIn(page, user);
  await expect(page.getByTestId("book")).toHaveCount(2, { timeout: 30_000 });
  const { pdf } = await import("./p12-helpers");
  await page.getByTestId("upload-input").setInputFiles(pdf("annotations"));
  await expect(page).toHaveURL(/\/app\/read\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "Back to library" }).click();
  const item = page.getByTestId("upload-item");
  await expect(item.first()).toHaveAttribute("data-stage", "done", { timeout: 40_000 });
  // While the card is up the library has extra bottom room, so it never hides the last row.
  const pad = await page
    .getByTestId("library")
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingBottom));
  expect(pad).toBeGreaterThan(60);
  await expect(item).toHaveCount(0, { timeout: 10_000 });
  await expect
    .poll(() =>
      page
        .getByTestId("library")
        .evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingBottom)),
    )
    .toBe(0);
});
