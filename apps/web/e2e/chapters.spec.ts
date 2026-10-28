import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";

// UX pass: the ebook-style sidebar (Chapters, Pages, Bookmarks), chapter header and progress,
// #p= deep links, copy chapter link, next-chapter control and the outline-less fallback.

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "../../fixtures/pdfs/manifest.json"), "utf8"),
) as { entries: { id: string; file: string }[] };
const pdf = (id: string) => {
  const entry = manifest.entries.find((e) => e.id === id);
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

const email = `e2e-chap-${randomUUID()}@example.com`;
const password = `pw-${randomUUID()}`;
const EVIDENCE = "../../evidence/ux-pass";
let userId = "";
const ids: Record<"paper" | "french" | "headings" | "ruler", string> = {
  paper: "",
  french: "",
  headings: "",
  ruler: "",
};

/** Four pages, no outline: large bold "Chapter N" headings on pages 1, 3 and 4. */
async function headingsPdf(): Promise<Buffer> {
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

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function upload(page: Page, file: string | { name: string; buffer: Buffer }) {
  await page.getByTestId("upload-input").setInputFiles(
    typeof file === "string"
      ? file
      : {
          name: file.name,
          mimeType: "application/pdf",
          buffer: file.buffer,
        },
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

async function open(page: Page, id: string, hash = "") {
  await page.goto(`/app/read/${id}${hash}`);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
}

const indicator = (page: Page) => page.getByTestId("page-indicator");
const currentRow = (page: Page) => page.locator('[data-testid="chapter-row"][data-current="true"]');

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mkdirSync(EVIDENCE, { recursive: true });
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
  const bucket = admin.storage.from("documents");
  const { data: folders } = await bucket.list(userId);
  const paths: string[] = [];
  for (const folder of folders ?? []) {
    const { data: files } = await bucket.list(`${userId}/${folder.name}`);
    for (const file of files ?? []) paths.push(`${userId}/${folder.name}/${file.name}`);
  }
  if (paths.length) await bucket.remove(paths);
  await admin.auth.admin.deleteUser(userId);
});

test("setup: upload the books", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  ids.paper = await upload(page, pdf("two-column-paper"));
  ids.french = await upload(page, pdf("french-accents-ligatures"));
  ids.headings = await upload(page, { name: "headings.pdf", buffer: await headingsPdf() });
  ids.ruler = await upload(page, pdf("ruler"));
});

test("chapters: the outline lists nested chapters; a click jumps; the header names the chapter", async ({
  page,
}) => {
  await signIn(page);
  await open(page, ids.paper);
  // The sidebar starts closed; the toggle opens it on the Chapters tab.
  await expect(page.getByTestId("reader-rail")).toHaveCount(0);
  await page.getByTestId("sidebar-toggle").click();
  await expect(page.getByTestId("chapter-row")).toHaveCount(11);
  await page.getByRole("button", { name: "V 1D: Su-Schrieffer-Heeger model" }).click();
  await expect(indicator(page)).toHaveText("4 / 9");
  await expect(currentRow(page)).toContainText("Su-Schrieffer-Heeger");
  await expect(page.getByTestId("chapter-title")).toContainText("Su-Schrieffer-Heeger");
  await expect(page.getByTestId("chapter-progress")).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/chapters-paper.png` });

  // Open or closed and the active tab are remembered across reloads.
  await page.reload();
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await expect(page.getByTestId("reader-rail")).toBeVisible();
  await page.getByRole("tab", { name: "Pages" }).click();
  await page.reload();
  await expect(page.getByRole("tab", { name: "Pages" })).toHaveAttribute("data-state", "active");
  await page.getByTestId("sidebar-toggle").click();
  await expect(page.getByTestId("reader-rail")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await expect(page.getByTestId("reader-rail")).toHaveCount(0);
});

test("chapters: the current chapter follows scrolling and nested ones expand to show it", async ({
  page,
}) => {
  await signIn(page);
  await open(page, ids.french);
  await page.getByTestId("sidebar-toggle").click();
  await page.getByRole("tab", { name: "Chapters" }).click();
  await expect(page.getByTestId("chapter-row").first()).toBeVisible();
  await page.mouse.move(700, 400);
  const seen = new Set<string>();
  for (let i = 0; i < 40 && seen.size < 2; i++) {
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(150);
    const row = currentRow(page);
    if ((await row.count()) > 0) seen.add((await row.first().innerText()).trim());
  }
  expect(seen.size).toBeGreaterThanOrEqual(2);
  // The highlighted row is inside the sidebar's visible area.
  const rail = await page.getByTestId("reader-rail").boundingBox();
  const row = await currentRow(page).first().boundingBox();
  expect(row && rail && row.y >= rail.y - 1 && row.y + row.height <= rail.y + rail.height + 1).toBe(
    true,
  );
  await page.screenshot({ path: `${EVIDENCE}/chapters-scroll.png` });
});

test("pages: thumbnails render at the page aspect ratio and the current page is marked", async ({
  page,
}) => {
  await signIn(page);
  await open(page, ids.paper);
  await page.getByTestId("sidebar-toggle").click();
  await page.getByRole("tab", { name: "Pages" }).click();
  const first = page.locator('.mr-thumb-page[data-rendered="true"] canvas').first();
  await expect(first).toBeVisible();
  const thumb = await first.boundingBox();
  const main = await page.locator('.mr-page[data-page="0"]').boundingBox();
  expect(thumb && thumb.width > 40 && thumb.height > 40).toBe(true);
  if (!(thumb && main)) throw new Error("no boxes");
  expect(Math.abs(thumb.width / thumb.height - main.width / main.height)).toBeLessThan(0.02);
  // A canvas that is blank would be one flat color: sample a few pixels.
  const varied = await first.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const data = c.getContext("2d")?.getImageData(0, 0, c.width, c.height).data;
    if (!data) return false;
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97) seen.add(data[i] ?? 0);
    return seen.size > 3;
  });
  expect(varied).toBe(true);
  await expect(page.locator('.mr-thumb[data-current="true"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Page 5", exact: true }).click();
  await expect(indicator(page)).toHaveText("5 / 9");
  await expect(page.locator('.mr-thumb[data-current="true"]')).toContainText("5");
  await page.screenshot({ path: `${EVIDENCE}/pages-tab.png` });
});

test("#p= opens at that page, and changing the hash navigates", async ({ page }) => {
  await signIn(page);
  await open(page, ids.paper, "#p=4");
  await expect(indicator(page)).toHaveText("4 / 9");
  await page.evaluate(() => {
    window.location.hash = "#p=7";
  });
  await expect(indicator(page)).toHaveText("7 / 9");
});

test("copy link on a chapter row copies <origin>/app/read/<id>#p=<page>", async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  await open(page, ids.paper);
  await page.getByTestId("sidebar-toggle").click();
  const row = page.getByTestId("chapter-row").filter({ hasText: "VI 2D: Dirac cone" });
  await row.hover();
  await row.getByTestId("chapter-copy-link").click();
  await expect(page.getByText("Link copied")).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toBe(`${baseURL}/app/read/${ids.paper}#p=5`);
  // Pasting it navigates.
  await open(page, ids.french, text.slice(text.indexOf("#")));
  await page.goto(text);
  await expect(indicator(page)).toHaveText("5 / 9");
});

test("next chapter appears at the end of a chapter and jumps to the next one", async ({ page }) => {
  await signIn(page);
  await open(page, ids.french);
  await expect(page.getByTestId("next-chapter")).toHaveCount(0);
  // Page 15 is the last page of "Exemples de chaînes de Markov" (pages 8 to 15).
  await page.evaluate(() => {
    window.location.hash = "#p=15";
  });
  await expect(indicator(page)).toHaveText("15 / 94");
  const next = page.getByTestId("next-chapter");
  await expect(next).toContainText("Next chapter: Rappels sur les chaînes de Markov");
  await page.screenshot({ path: `${EVIDENCE}/next-chapter.png` });
  await next.click();
  await expect(indicator(page)).toHaveText("16 / 94");
  await expect(page.getByTestId("chapter-title")).toContainText("Rappels sur les chaînes");
  await expect(page.getByTestId("next-chapter")).toHaveCount(0);
});

test("a PDF without an outline gets detected headings", async ({ page }) => {
  await signIn(page);
  await open(page, ids.headings);
  await page.getByTestId("sidebar-toggle").click();
  await expect(page.getByTestId("chapters-detected")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("chapter-row")).toHaveCount(3);
  await page.getByRole("button", { name: "Chapter 3 The End" }).first().click();
  await expect(indicator(page)).toHaveText("4 / 4");
  await expect(page.getByTestId("chapter-title")).toContainText("Chapter 3 The End");
  await page.screenshot({ path: `${EVIDENCE}/chapters-detected.png` });
});

test("a PDF with no outline and no headings says so and points to Pages", async ({ page }) => {
  await signIn(page);
  await open(page, ids.ruler);
  await page.getByTestId("sidebar-toggle").click();
  const empty = page.getByTestId("chapters-empty");
  await expect(empty).toContainText("This PDF has no table of contents.", { timeout: 15_000 });
  await empty.getByRole("button", { name: "Pages tab" }).click();
  await expect(page.getByRole("tab", { name: "Pages" })).toHaveAttribute("data-state", "active");
  await page.screenshot({ path: `${EVIDENCE}/chapters-empty.png` });
});

test("bookmarks live in the sidebar", async ({ page }) => {
  await signIn(page);
  await open(page, ids.ruler);
  await page.keyboard.press("b");
  await expect(page.getByTestId("bookmark-ribbon")).toBeVisible();
  await page.getByTestId("sidebar-toggle").click();
  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await expect(page.getByTestId("bookmark-item")).toHaveText("Page 1");
  await page.keyboard.press("b");
  await expect(page.getByTestId("bookmark-item")).toHaveCount(0);
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("the sidebar is a sheet; picking a chapter closes it", async ({ page }) => {
    await signIn(page);
    await open(page, ids.paper);
    await expect(page.getByTestId("reader-rail")).toHaveCount(0);
    await page.getByTestId("sidebar-toggle").click();
    const sheet = page.getByTestId("reader-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("chapter-row").first()).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/mobile-sheet.png` });
    await sheet.getByRole("button", { name: "VII Experimental measures" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(indicator(page)).toHaveText("6 / 9");
  });
});
