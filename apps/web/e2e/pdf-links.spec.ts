import { mkdirSync, readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { PDFArray, PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { createUser, deleteUser, pdf, signIn, type TestUser } from "./p12-helpers";

// N2: links inside the PDF work (internal jumps with a Back pill, external URLs in a new tab),
// scripts never run, and text selection and highlights keep priority over a link.

const EVIDENCE = "../../evidence/n2-pdf-links";
let user: TestUser;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  user = await createUser("pdflinks");
  mkdirSync(EVIDENCE, { recursive: true });
});
test.afterAll(async () => deleteUser(user));

const CLICK_ME = "Jump to the proof on page three, see section 3.";

/** Three pages. Page 1 carries: an internal link, an https link, a javascript: link, a JS action, a file: link. */
async function linkedPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  const p2 = doc.addPage([612, 792]);
  const p3 = doc.addPage([612, 792]);
  const line = (y: number, text: string) => p1.drawText(text, { x: 72, y, size: 14, font });
  const link = (y: number, entries: Record<string, unknown>) => {
    const dict = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [72, y - 3, 460, y + 14],
      Border: [0, 0, 0],
      ...entries,
    } as never);
    const annots = p1.node.lookupMaybe(PDFName.of("Annots"), PDFArray) ?? doc.context.obj([]);
    annots.push(doc.context.register(dict));
    p1.node.set(PDFName.of("Annots"), annots);
  };
  line(700, CLICK_ME);
  link(700, { Dest: doc.context.obj([p3.ref, "XYZ", 0, 600, null]) });
  line(650, "Visit the example site now");
  link(650, { A: { Type: "Action", S: "URI", URI: PDFString.of("https://example.org/") } });
  line(600, "Run the script (javascript: link)");
  link(600, { A: { Type: "Action", S: "URI", URI: PDFString.of("javascript:alert(1)") } });
  line(550, "Trigger the JavaScript action");
  link(550, { A: { Type: "Action", S: "JavaScript", JS: PDFString.of("app.alert('x')") } });
  line(500, "Open a local file");
  link(500, { A: { Type: "Action", S: "URI", URI: PDFString.of("file:///etc/passwd") } });
  p2.drawText("Page two filler", { x: 72, y: 700, size: 14, font });
  p3.drawText("Page three: the proof", { x: 72, y: 600, size: 14, font });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

async function openUpload(page: Page, file: string | { name: string; buffer: Buffer }) {
  await page
    .getByTestId("upload-input")
    .setInputFiles(
      typeof file === "string"
        ? file
        : { name: file.name, mimeType: "application/pdf", buffer: file.buffer },
    );
  await expect(page).toHaveURL(/\/app\/read\/[0-9a-f-]{36}$/);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await expect(page.locator(".mr-textlayer > span").first()).toBeAttached();
}

const centre = async (box: Locator) => {
  await box.scrollIntoViewIfNeeded();
  const b = await box.boundingBox();
  if (!b) throw new Error("no box");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
};

/** Points of page `i` that sit above the top of the viewport (what the reader has scrolled past). */
const topPt = (page: Page, i: number) =>
  page.evaluate((idx) => {
    const sc = document.querySelector(".mr-scroller") as HTMLElement;
    const pg = document.querySelector(`.mr-page[data-page="${idx}"]`) as HTMLElement;
    const space = pg.querySelector(".mr-space") as HTMLElement;
    const scale = pg.getBoundingClientRect().width / space.offsetWidth;
    return (sc.getBoundingClientRect().top - pg.getBoundingClientRect().top) / scale;
  }, i);

const currentPage = async (page: Page) =>
  Number(await page.locator(".mr-viewer").getAttribute("data-current-page"));

test("two-column paper: a citation lands on its destination page and Back returns within a line", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, user);
  await openUpload(page, pdf("two-column-paper"));

  // The destination, resolved independently by PDF.js in Node (named destination -> page index).
  const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = lib.getDocument({ data: new Uint8Array(readFileSync(pdf("two-column-paper"))) });
  const pdfDoc = await task.promise;
  const first = await pdfDoc.getPage(1);
  const annots = (await first.getAnnotations()) as { subtype: string; dest?: string }[];
  const cite = annots.find((a) => a.subtype === "Link" && a.dest?.startsWith("cite."));
  const resolved = (await pdfDoc.getDestination(cite?.dest as string)) as unknown[];
  const expectedPage = await pdfDoc.getPageIndex(resolved[0] as { num: number; gen: number });
  const expectedOffset = (first.view[3] as number) - (resolved[3] as number);
  expect(expectedPage).toBeGreaterThan(0);
  await task.destroy();

  await expect(
    page.locator('.mr-page[data-page="0"] .mr-link[data-link="internal"]').first(),
  ).toBeAttached();
  const box = page
    .locator(
      `.mr-page[data-page="0"] .mr-link[data-link="internal"][data-target-page="${expectedPage}"]`,
    )
    .first();
  await expect(box).toHaveAttribute("aria-label", `Go to page ${expectedPage + 1}`);
  const offsetAttr = Number(await box.getAttribute("data-target-offset"));
  expect(Math.abs(offsetAttr - expectedOffset)).toBeLessThan(1);

  const c = await centre(box);
  const startTop = await topPt(page, 0);
  const startPage = await currentPage(page);
  await page.mouse.move(c.x, c.y);
  await expect(page.locator(".mr-viewer")).toHaveClass(/mr-over-link/);
  await page.mouse.click(c.x, c.y);

  // Landed: the destination point is 24 px (18 pt at 100 %) below the top of the viewport.
  await expect(page.getByTestId("back-pill")).toHaveText(`Back to p. ${startPage + 1}`);
  const landed = async () => Math.abs((await topPt(page, expectedPage)) - (expectedOffset - 18));
  await expect.poll(landed).toBeLessThan(8);
  await page.screenshot({ path: `${EVIDENCE}/desktop-after-jump.png` });

  await page.getByTestId("back-pill").click();
  await expect(page.getByTestId("back-pill")).toBeHidden();
  await expect.poll(async () => Math.abs((await topPt(page, 0)) - startTop)).toBeLessThan(12);

  // Alt+Left does the same, Alt+Right goes forward again.
  await page.mouse.click(c.x, c.y);
  await expect(page.getByTestId("back-pill")).toBeVisible();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("back-pill")).toBeHidden();
  await expect.poll(async () => Math.abs((await topPt(page, 0)) - startTop)).toBeLessThan(12);
  await page.keyboard.press("Alt+ArrowRight");
  await expect.poll(landed).toBeLessThan(8);

  // Scrolling far from the landing hides the pill (Home is 3+ pages away from the references).
  await page.keyboard.press("Alt+ArrowLeft");
  await page.mouse.click(c.x, c.y);
  await expect(page.getByTestId("back-pill")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("back-pill")).toBeHidden();
});

test("synthetic PDF: external link opens a tab; scripts, javascript: and file: never run", async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  await context.route("https://example.org/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>example</title>ok" }),
  );
  const popups: string[] = [];
  context.on("page", (p) => popups.push(p.url()));
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await signIn(page, user);
  await openUpload(page, { name: "linked.pdf", buffer: await linkedPdf() });
  const bookUrl = page.url();

  // Only the internal link and the https link get a box.
  await expect(page.locator('.mr-page[data-page="0"] .mr-link')).toHaveCount(2);
  const internal = page.getByRole("button", { name: "Go to page 3" });
  const external = page.getByRole("link", { name: "Open link to example.org" });
  await expect(internal).toBeAttached();
  await expect(external).toHaveAttribute("href", "https://example.org/");
  await expect(external).toHaveAttribute("target", "_blank");
  await expect(external).toHaveAttribute("rel", "noopener noreferrer");

  // The javascript:, JS-action and file: lines are plain text: clicking does nothing.
  const pageBox = await page.locator('.mr-page[data-page="0"]').boundingBox();
  if (!pageBox) throw new Error("no page");
  const scale = pageBox.width / 612;
  for (const y of [600, 550, 500]) {
    await page.mouse.click(pageBox.x + 150 * scale, pageBox.y + (792 - y - 5) * scale);
  }
  await page.waitForTimeout(500);
  expect(popups).toEqual([]);
  expect(dialogs).toEqual([]);
  await expect(page).toHaveURL(bookUrl);
  await expect(page.getByTestId("back-pill")).toBeHidden();

  // The https link opens a new tab.
  const c = await centre(external);
  const [popup] = await Promise.all([context.waitForEvent("page"), page.mouse.click(c.x, c.y)]);
  await popup.waitForLoadState();
  expect(popup.url()).toBe("https://example.org/");
  await popup.close();
  await expect(page).toHaveURL(bookUrl);

  // Keyboard: reachable, named, Enter follows the internal link.
  await internal.focus();
  await expect(internal).toBeFocused();
  await page.screenshot({ path: `${EVIDENCE}/desktop-focus-ring.png` });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("back-pill")).toHaveText("Back to p. 1");
  await expect.poll(() => currentPage(page)).toBe(2);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("back-pill")).toBeHidden();
});

test("synthetic PDF: dragging across a link selects text, a saved highlight keeps priority over the link, the pill expires", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.clock.install();
  await signIn(page, user);
  await openUpload(page, { name: "linked-2.pdf", buffer: await linkedPdf() });

  const internal = page.getByRole("button", { name: "Go to page 3" });
  const c = await centre(internal);
  // Drag from inside the link to the right along the line: selects text, does not jump.
  await page.mouse.move(c.box.x + 6, c.y);
  await page.mouse.down();
  await page.mouse.move(c.box.x + c.box.width * 0.6, c.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("annotation-popover")).toBeVisible();
  await expect(page.getByTestId("back-pill")).toBeHidden();
  expect(await currentPage(page)).toBe(0);

  // Save it as a highlight, then click it: the popover opens and the link is not followed.
  await page.keyboard.press("1");
  await expect(page.getByTestId("highlight-rect").first()).toBeVisible();
  await page.mouse.click(c.box.x + c.box.width * 0.3, c.y);
  await expect(page.getByTestId("annotation-popover")).toBeVisible();
  await expect(page.getByTestId("back-pill")).toBeHidden();
  expect(await currentPage(page)).toBe(0);

  // Past the highlight, the same link still works with a plain click (no movement).
  await page.keyboard.press("Escape");
  await page.mouse.click(c.box.x + c.box.width * 0.9, c.y);
  await expect(page.getByTestId("back-pill")).toBeVisible();

  // The pill expires after 15 s.
  await page.clock.fastForward(16_000);
  await expect(page.getByTestId("back-pill")).toBeHidden();
  await page.clock.resume();
});

test("javascript-forms.pdf: its link action never runs or navigates", async ({ page, context }) => {
  test.setTimeout(150_000);
  const popups: string[] = [];
  context.on("page", (p) => popups.push(p.url()));
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await signIn(page, user);
  await openUpload(page, pdf("javascript-forms"));
  const bookUrl = page.url();
  await expect(page.locator(".mr-link")).toHaveCount(0);
  // The fixture's link annotation sits at [72, 459.7, 286, 469.9] (y up) on a 792 pt page.
  const pageBox = await page.locator('.mr-page[data-page="0"]').boundingBox();
  if (!pageBox) throw new Error("no page");
  const scale = pageBox.width / 612;
  await page.mouse.click(pageBox.x + 150 * scale, pageBox.y + (792 - 464.8) * scale);
  await page.waitForTimeout(800);
  expect(popups).toEqual([]);
  expect(dialogs).toEqual([]);
  await expect(page).toHaveURL(bookUrl);
  await expect(page.getByTestId("back-pill")).toBeHidden();
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("the back pill shows on a phone and returns", async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page, user);
    await openUpload(page, { name: "linked-3.pdf", buffer: await linkedPdf() });
    const internal = page.getByRole("button", { name: "Go to page 3" });
    const c = await centre(internal);
    await page.mouse.click(c.x, c.y);
    const pill = page.getByTestId("back-pill");
    await expect(pill).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/phone-after-jump.png` });
    await pill.click();
    await expect(pill).toBeHidden();
    expect(await currentPage(page)).toBe(0);
  });
});
