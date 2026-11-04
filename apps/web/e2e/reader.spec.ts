import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

// P07: the reader core, driven through the dev harness at /dev/reader?fixture=<id>.
// Not covered here (follow-ups): dropped frames while scrolling and tab memory on the large files.

interface KnownText {
  text: string;
  pageIndex: number;
  rect: [number, number, number, number];
  tolerance: number;
  inTextLayer: boolean;
}
interface ManifestEntry {
  id: string;
  expected: { knownText: KnownText[]; encryption?: { userPassword: string } };
}
const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "../../fixtures/pdfs/manifest.json"), "utf8"),
) as { entries: ManifestEntry[] };
const fixtureEntry = (id: string) => {
  const entry = manifest.entries.find((e) => e.id === id);
  if (!entry) throw new Error(`no fixture ${id}`);
  return entry;
};

type ReaderWindow = Window & {
  __reader?: {
    setZoom: (z: "fit-width" | "fit-page" | number) => void;
    goToPage: (p: number) => void;
  };
};

async function openFixture(page: Page, id: string) {
  await page.goto(`/dev/reader?fixture=${id}`);
  await expect(page.locator(".mr-viewer")).toHaveAttribute("data-status", "ready");
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
}

const percent = async (page: Page) =>
  Number(await page.locator(".mr-viewer").getAttribute("data-zoom-percent"));
const currentPage = async (page: Page) =>
  Number(await page.locator(".mr-viewer").getAttribute("data-current-page"));

test.describe("reader core", () => {
  test("opens a fixture, shows page count and reports first-page time", async ({ page }) => {
    await page.goto("/dev/reader?fixture=two-column-paper");
    await expect(page.getByTestId("first-page-ms")).not.toBeEmpty();
    const cold = Number(await page.getByTestId("first-page-ms").textContent());
    await expect(page.getByTestId("page-indicator")).toHaveText("1 / 9");
    // Second open in the same browser: HTTP and worker caches are warm.
    await page.reload();
    await expect(page.getByTestId("first-page-ms")).not.toBeEmpty();
    const warm = Number(await page.getByTestId("first-page-ms").textContent());
    console.log(
      `FIRST_PAGE_MS two-column-paper (2.5 MB): first load ${cold} ms, reload ${warm} ms`,
    );
    expect(cold).toBeLessThan(2000);
  });

  test("renders only a window of pages and releases the rest", async ({ page }) => {
    await openFixture(page, "french-accents-ligatures");
    const mounted = () => page.locator(".mr-page").count();
    expect(await mounted()).toBeLessThanOrEqual(8);
    await page.evaluate(() => (window as ReaderWindow).__reader?.goToPage(60));
    await expect(page.locator('.mr-page[data-page="60"] .mr-canvas')).toBeVisible();
    await expect(page.locator('.mr-page[data-page="0"]')).toHaveCount(0);
    expect(await mounted()).toBeLessThanOrEqual(8);
  });

  test("zoom: buttons, keys, ctrl+wheel, fit modes, limits", async ({ page }) => {
    await openFixture(page, "two-column-paper");
    const start = await percent(page);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(() => percent(page)).toBeGreaterThan(start);
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.keyboard.press("-");
    await expect.poll(() => percent(page)).toBeLessThan(start);
    await page.keyboard.press("0");
    await expect.poll(() => percent(page)).toBe(start);

    await page.locator(".mr-scroller").hover();
    const before = await percent(page);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -200);
    await page.keyboard.up("Control");
    await expect.poll(() => percent(page)).toBeGreaterThan(before);

    await page.getByRole("button", { name: "Fit page" }).click();
    const fitPage = await percent(page);
    expect(fitPage).toBeLessThan(start);

    for (let i = 0; i < 15; i++) await page.keyboard.press("+");
    await expect.poll(() => percent(page)).toBe(400);
    for (let i = 0; i < 15; i++) await page.keyboard.press("-");
    await expect.poll(() => percent(page)).toBe(50);
  });

  test("sharp at high zoom: the canvas backing store follows the zoom", async ({ page }) => {
    await openFixture(page, "ruler");
    await page.evaluate(() => (window as ReaderWindow).__reader?.setZoom(100));
    const width = () =>
      page.evaluate(
        () => document.querySelector<HTMLCanvasElement>(".mr-page .mr-canvas")?.width ?? 0,
      );
    await expect.poll(width).toBe(816); // 612 pt at 100% = 816 CSS px, at devicePixelRatio 1
    await page.evaluate(() => (window as ReaderWindow).__reader?.setZoom(300));
    await expect.poll(width).toBe(2448);
  });

  test("outline: lists items and jumps to them", async ({ page }) => {
    await openFixture(page, "french-accents-ligatures");
    const links = page.locator(".mr-outline-link");
    await expect(links.first()).toBeVisible();
    expect(await links.count()).toBeGreaterThanOrEqual(2);
    await page.getByRole("button", { name: "Expand" }).first().click();
    expect(await links.count()).toBeGreaterThan(2);
    await links.nth(2).click();
    await expect.poll(() => currentPage(page)).toBeGreaterThan(0);
    await expect(page.locator(".mr-outline-row[data-current='true']")).toHaveCount(1);
  });

  test("thumbnails render lazily and navigate", async ({ page }) => {
    await openFixture(page, "french-accents-ligatures");
    await page.getByRole("tab", { name: "Thumbnails" }).click();
    await expect(page.locator(".mr-thumb")).toHaveCount(94);
    await expect(page.locator(".mr-thumb-page[data-rendered='true']").first()).toBeVisible();
    const rendered = await page.locator(".mr-thumb-page[data-rendered='true']").count();
    expect(rendered).toBeLessThan(40);
    await page.getByRole("button", { name: "Page 12", exact: true }).click();
    await expect.poll(() => currentPage(page)).toBe(11);
  });

  test("find: highlights every hit, counts, next and previous", async ({ page }) => {
    await openFixture(page, "two-column-paper");
    await page.keyboard.press("/");
    await expect(page.getByTestId("find-input")).toBeFocused();
    await page.getByTestId("find-input").fill("entanglement");
    await page.keyboard.press("Enter");
    const count = page.getByTestId("find-count");
    await expect(count).toHaveAttribute("data-searching", "false");
    await expect(count).toHaveText(/^1 \/ \d+$/);
    const total = Number((await count.textContent())?.split("/")[1]);
    expect(total).toBeGreaterThan(3);
    await expect(page.locator(".mr-hit").first()).toBeVisible();
    await expect(page.locator(".mr-hit-current")).toHaveCount(1);
    await page.getByRole("button", { name: "Next match" }).click();
    await expect(count).toHaveText(`2 / ${total}`);
    await page.getByRole("button", { name: "Previous match" }).click();
    await page.getByRole("button", { name: "Previous match" }).click();
    await expect(count).toHaveText(`${total} / ${total}`);
    await page.getByTestId("find-input").fill("zzzzqqqq");
    await page.keyboard.press("Enter");
    await expect(count).toHaveText("0");
  });

  test("shortcuts: pages, chapters, find, go to page, zoom, theme", async ({ page }) => {
    await openFixture(page, "french-accents-ligatures");
    await page.locator(".mr-scroller").focus();
    await page.keyboard.press("PageDown");
    await expect.poll(() => currentPage(page)).toBe(1);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => currentPage(page)).toBe(2);
    await page.keyboard.press("PageUp");
    await expect.poll(() => currentPage(page)).toBe(1);
    await page.keyboard.press("End");
    await expect.poll(() => currentPage(page)).toBe(93);
    await page.keyboard.press("Home");
    await expect.poll(() => currentPage(page)).toBe(0);
    const top = () => page.locator(".mr-scroller").evaluate((el) => el.scrollTop);
    const t0 = await top();
    await page.keyboard.press("Space");
    await expect.poll(top).toBeGreaterThan(t0);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Shift+Space");
    await page.keyboard.press("]");
    await page.keyboard.press("]");
    await expect.poll(() => currentPage(page)).toBeGreaterThan(0);
    const chapterPage = await currentPage(page);
    await page.keyboard.press("[");
    await expect.poll(() => currentPage(page)).toBeLessThan(chapterPage);
    await page.keyboard.press("g");
    await page.getByTestId("goto-input").fill("20");
    await page.keyboard.press("Enter");
    await expect.poll(() => currentPage(page)).toBe(19);
    await page.locator(".mr-scroller").focus();
    await page.keyboard.press("Control+f");
    await expect(page.getByTestId("find-input")).toBeFocused();
    await page.keyboard.press("Escape");
    await page.locator(".mr-scroller").focus();
    const theme = () => page.evaluate(() => document.documentElement.className);
    await page.keyboard.press("t");
    await expect.poll(theme).toMatch(/sepia|dark/);
  });

  test("password: prompts, rejects a wrong password, opens with the right one", async ({
    page,
  }) => {
    const password = fixtureEntry("encrypted").expected.encryption?.userPassword ?? "";
    await page.goto("/dev/reader?fixture=encrypted");
    const prompt = page.getByTestId("password-prompt");
    await expect(prompt).toBeVisible();
    await prompt.locator("input").fill("not-it");
    await prompt.getByRole("button", { name: "Unlock" }).click();
    await expect(prompt).toContainText("didn't work");
    await prompt.locator("input").fill(password);
    await prompt.getByRole("button", { name: "Unlock" }).click();
    await expect(page.locator(".mr-viewer")).toHaveAttribute("data-status", "ready");
    await expect(page.locator(".mr-textlayer span").first()).toContainText("encrypted");
    // The password is held in memory only.
    const stored = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    expect(stored).not.toContain(password);
  });

  test("corrupted file: friendly error or partial render, never a crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/dev/reader?fixture=corrupted");
    await expect(page.locator(".mr-viewer")).toHaveAttribute("data-status", /ready|error/);
    const status = await page.locator(".mr-viewer").getAttribute("data-status");
    if (status === "error") {
      await expect(page.getByTestId("reader-error")).toContainText(/PDF|file/i);
    } else {
      await expect(page.locator(".mr-page").first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("a garbage file shows a friendly error", async ({ page }) => {
    await page.goto("/dev/reader");
    await page.getByTestId("file-input").setInputFiles({
      name: "notes.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("this is not a pdf at all"),
    });
    await expect(page.getByTestId("reader-error")).toContainText(
      "doesn't look like a readable PDF",
    );
  });

  test("PDF JavaScript never runs", async ({ page }) => {
    const dialogs: string[] = [];
    const errors: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await openFixture(page, "javascript-forms");
    await expect(page.locator(".mr-textlayer span").first()).toContainText("form fields");
    await page.waitForTimeout(500);
    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);
    expect(await page.title()).toBe("Anagnosis · Reader");
  });

  test("opens a PDF from the user's computer in memory (no upload)", async ({ page }) => {
    const uploads: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") uploads.push(request.url());
    });
    await page.goto("/dev/reader");
    const bytes = readFileSync(join(process.cwd(), "../../fixtures/pdfs/generated/ruler.pdf"));
    await page
      .getByTestId("file-input")
      .setInputFiles({ name: "my-book.pdf", mimeType: "application/pdf", buffer: bytes });
    await expect(page.getByTestId("book-title")).toHaveText("my-book");
    await expect(page.getByTestId("page-indicator")).toHaveText("1 / 2");
    expect(uploads).toEqual([]);
  });
});

// Selecting a known run and reading back the target: rects must match the corpus to 1 pt.
async function selectRun(page: Page, text: string, pageIndex: number) {
  await page.evaluate(
    ({ text, pageIndex }) => {
      const spans = [
        ...document.querySelectorAll<HTMLElement>(`.mr-textlayer > span[data-page="${pageIndex}"]`),
      ];
      const span = spans.find((s) => s.textContent === text);
      if (!span?.firstChild) throw new Error(`no span for ${text}`);
      const range = document.createRange();
      range.selectNodeContents(span);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    { text, pageIndex },
  );
  await expect(page.getByTestId("selection-json")).not.toBeEmpty();
  return JSON.parse((await page.getByTestId("selection-json").textContent()) ?? "null") as {
    segments: { page: number; rects: [number, number, number, number][] }[];
    quote: { exact: string };
  };
}

test.describe("selection accuracy", () => {
  const MAX_ERROR_PT = 1;
  test.setTimeout(150_000); // ~140 select-and-read round trips, each waits out the selection debounce

  test("ruler: rects within 1 pt of the known coordinates at 50/100/200/300%", async ({ page }) => {
    await openFixture(page, "ruler");
    const known = fixtureEntry("ruler").expected.knownText.filter((k) => k.inTextLayer);
    let worst = 0;
    let checked = 0;
    for (const zoom of [50, 100, 200, 300]) {
      await page.evaluate((z) => (window as ReaderWindow).__reader?.setZoom(z), zoom);
      await expect.poll(() => percent(page)).toBe(zoom);
      for (const k of known) {
        await page.evaluate((p) => (window as ReaderWindow).__reader?.goToPage(p), k.pageIndex);
        const hasSpan = await page
          .locator(`.mr-textlayer > span[data-page="${k.pageIndex}"]`)
          .filter({ hasText: k.text })
          .count();
        if (!hasSpan) continue; // known text that PDF.js splits into several runs is covered below
        await page.evaluate(() => document.getSelection()?.removeAllRanges());
        await expect(page.getByTestId("selection-json")).toBeEmpty();
        const target = await selectRun(page, k.text, k.pageIndex);
        const segment = target.segments[0];
        expect(segment?.page).toBe(k.pageIndex);
        expect(segment?.rects).toHaveLength(1);
        expect(target.quote.exact).toBe(k.text);
        const rect = segment?.rects[0] ?? [0, 0, 0, 0];
        for (let i = 0; i < 4; i++)
          worst = Math.max(worst, Math.abs((rect[i] as number) - (k.rect[i] as number)));
        checked++;
      }
    }
    console.log(`RULER_ACCURACY checked ${checked} selections, max error ${worst.toFixed(3)} pt`);
    expect(checked).toBeGreaterThan(20);
    expect(worst).toBeLessThanOrEqual(MAX_ERROR_PT);
  });

  test("mixed pages: rotated pages (90/180/270) and a CropBox offset stay within 1 pt", async ({
    page,
  }) => {
    await openFixture(page, "mixed-pages");
    const known = fixtureEntry("mixed-pages").expected.knownText;
    let worst = 0;
    for (const k of known) {
      await page.evaluate((p) => (window as ReaderWindow).__reader?.goToPage(p), k.pageIndex);
      await expect(page.locator(`.mr-page[data-page="${k.pageIndex}"] .mr-canvas`)).toBeVisible();
      await page.evaluate(() => document.getSelection()?.removeAllRanges());
      await expect(page.getByTestId("selection-json")).toBeEmpty();
      const target = await selectRun(page, k.text, k.pageIndex);
      const rect = target.segments[0]?.rects[0] ?? [0, 0, 0, 0];
      for (let i = 0; i < 4; i++)
        worst = Math.max(worst, Math.abs((rect[i] as number) - (k.rect[i] as number)));

      // The text layer must sit on the rendered text: the span overlaps the box where the
      // page-to-viewport transform of the known rect lands.
      const overlap = await page.evaluate(
        ({ pageIndex, text, rect }) => {
          const pageEl = document.querySelector(
            `.mr-page[data-page="${pageIndex}"]`,
          ) as HTMLElement;
          const span = [...pageEl.querySelectorAll<HTMLElement>(".mr-textlayer > span")].find(
            (s) => s.textContent === text,
          ) as HTMLElement;
          const box = pageEl.getBoundingClientRect();
          const rotation = Number(pageEl.dataset.rotation);
          const view = pageEl.querySelector<HTMLElement>(".mr-space");
          const scale = Number(
            new DOMMatrix(getComputedStyle(view as HTMLElement).transform).a ||
              new DOMMatrix(getComputedStyle(view as HTMLElement).transform).b,
          );
          const s = Math.abs(scale);
          // page space -> unscaled rotated space, using the same quarter turns as annotation-model
          const w = Number((view as HTMLElement).style.width.replace("px", ""));
          const h = Number((view as HTMLElement).style.height.replace("px", ""));
          const turn = (x: number, y: number): [number, number] =>
            rotation === 90
              ? [h - y, x]
              : rotation === 180
                ? [w - x, h - y]
                : rotation === 270
                  ? [y, w - x]
                  : [x, y];
          const a = turn(rect[0], rect[1]);
          const b = turn(rect[2], rect[3]);
          const expected = {
            left: box.left + Math.min(a[0], b[0]) * s,
            right: box.left + Math.max(a[0], b[0]) * s,
            top: box.top + Math.min(a[1], b[1]) * s,
            bottom: box.top + Math.max(a[1], b[1]) * s,
          };
          const got = span.getBoundingClientRect();
          const ix = Math.max(
            0,
            Math.min(expected.right, got.right) - Math.max(expected.left, got.left),
          );
          const iy = Math.max(
            0,
            Math.min(expected.bottom, got.bottom) - Math.max(expected.top, got.top),
          );
          return (ix * iy) / ((expected.right - expected.left) * (expected.bottom - expected.top));
        },
        { pageIndex: k.pageIndex, text: k.text, rect: k.rect },
      );
      expect(overlap, `text layer alignment for page ${k.pageIndex}`).toBeGreaterThan(0.5);
    }
    console.log(`MIXED_ACCURACY max error ${worst.toFixed(3)} pt over ${known.length} selections`);
    expect(worst).toBeLessThanOrEqual(MAX_ERROR_PT);
  });

  test("a selection across two pages yields two segments and one quote", async ({ page }) => {
    await openFixture(page, "ruler");
    await page.evaluate(() => (window as ReaderWindow).__reader?.setZoom(50));
    await page.evaluate(() => {
      const a = document.querySelector(
        '.mr-textlayer > span[data-page="0"]:last-of-type',
      ) as HTMLElement;
      const b = document.querySelector('.mr-textlayer > span[data-page="1"]') as HTMLElement;
      const range = document.createRange();
      range.setStart(a.firstChild as Text, 0);
      range.setEnd(b.firstChild as Text, (b.firstChild as Text).length);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
    });
    await expect(page.getByTestId("selection-json")).not.toBeEmpty();
    const target = JSON.parse((await page.getByTestId("selection-json").textContent()) ?? "{}") as {
      segments: { page: number }[];
    };
    expect(target.segments.map((s) => s.page)).toEqual([0, 1]);
  });
});

test.describe("Arabic and French", () => {
  test("French: double-click selects a real word; find ignores accents and ligatures", async ({
    page,
  }) => {
    await openFixture(page, "french-accents-ligatures");
    await page.evaluate(() => (window as ReaderWindow).__reader?.goToPage(9));
    const run = page
      .locator('.mr-textlayer > span[data-page="9"]')
      .filter({ hasText: "molécules" })
      .first();
    await run.scrollIntoViewIfNeeded();
    const word = await run.evaluate((el) => {
      const text = el.textContent ?? "";
      const at = text.indexOf("molécules");
      const range = document.createRange();
      range.setStart(el.firstChild as Text, at);
      range.setEnd(el.firstChild as Text, at + "molécules".length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.dblclick(word.x, word.y);
    await expect(page.getByTestId("selection-json")).not.toBeEmpty();
    const target = JSON.parse((await page.getByTestId("selection-json").textContent()) ?? "{}") as {
      quote: { exact: string };
    };
    expect(target.quote.exact.trim()).toBe("molécules");

    await page.keyboard.press("/");
    await page.getByTestId("find-input").fill("film");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("find-count")).toHaveAttribute("data-searching", "false");
    await expect(page.getByTestId("find-count")).toHaveText(/^1 \/ \d+$/);
    const withLigature = Number(
      (await page.getByTestId("find-count").textContent())?.split("/")[1],
    );
    expect(withLigature).toBeGreaterThan(1);
    await page.getByTestId("find-input").fill("MOLECULES");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("find-count")).toHaveText(/^1 \/ \d+$/);
    await expect(page.locator(".mr-hit").first()).toBeVisible();
  });

  test("Arabic: selection and find work on right-to-left text", async ({ page }) => {
    await openFixture(page, "arabic-rtl");
    const phrase = fixtureEntry("arabic-rtl").expected.knownText[0]?.text ?? "";
    await page.keyboard.press("/");
    await page.getByTestId("find-input").fill(phrase);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("find-count")).toHaveText(/^1 \/ \d+$/);
    await expect(page.locator(".mr-hit").first()).toBeVisible();

    const run = page
      .locator('.mr-textlayer > span[data-page="0"]')
      .filter({ hasText: /[؀-ۿ]{4,}/ })
      .first();
    const point = await run.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.dblclick(point.x, point.y);
    await expect(page.getByTestId("selection-json")).not.toBeEmpty();
    const target = JSON.parse((await page.getByTestId("selection-json").textContent()) ?? "{}") as {
      quote: { exact: string };
      segments: { rects: number[][] }[];
    };
    expect(target.quote.exact).toMatch(/[؀-ۿ]/);
    expect(target.segments[0]?.rects.length).toBeGreaterThan(0);
  });
});
