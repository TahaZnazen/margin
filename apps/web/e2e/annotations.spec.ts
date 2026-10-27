import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// P09: highlights, edit, undo, bookmarks, deep link, against the dev Supabase project.

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

const email = `e2e-ann-${randomUUID()}@example.com`;
const password = `pw-${randomUUID()}`;
let userId = "";
let rulerId = "";
let mixedId = "";
const EVIDENCE = "../../evidence/p09";

const L1 = "Line one of the ruler paragraph begins exactly at x = 72 pt.";
const L2 = "Every line in this block uses 11 pt Helvetica with 15 pt leading.";
const L3 = "Highlights that span several lines must stay aligned at any zoom.";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function annotationRows() {
  const { data } = await admin
    .from("annotations")
    .select("id, kind, color, comment, quote_text, page_start, deleted_at, document_id, target")
    .eq("user_id", userId)
    .order("created_at");
  return data ?? [];
}

const settled = (page: Page) =>
  expect(page.getByTestId("pending-writes")).toHaveText("0", { timeout: 15_000 });

async function selectText(page: Page, pageIndex: number, text: string) {
  await page.evaluate(
    ([p, t]) => {
      const spans = [
        ...document.querySelectorAll<HTMLElement>(
          `.mr-page[data-page="${p}"] .mr-textlayer > span`,
        ),
      ];
      const span =
        spans.find((s) => s.textContent === t) ??
        spans.find((s) => s.textContent?.includes(t as string));
      if (!span) throw new Error(`no span for ${t}`);
      const range = document.createRange();
      range.selectNodeContents(span);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    [pageIndex, text] as const,
  );
  await expect(page.getByTestId("annotation-popover")).toBeVisible();
}

async function setZoom(page: Page, target: number) {
  const current = async () =>
    Number(await page.locator(".mr-viewer").getAttribute("data-zoom-percent"));
  const steps = [50, 67, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400];
  for (let i = 0; i < 15 && (await current()) !== target; i++) {
    const now = await current();
    await page.keyboard.press(steps.indexOf(target) > steps.findIndex((s) => s >= now) ? "+" : "-");
    await page.waitForTimeout(60);
  }
  await expect.poll(current).toBe(target);
  await page.waitForTimeout(500);
}

type Known = { text: string; pageIndex: number; rect: [number, number, number, number] };
const known = (id: string, text: string): Known => {
  const entry = manifest.entries.find((e) => e.id === id) as unknown as {
    expected: { knownText: Known[] };
  };
  const hit = entry.expected.knownText.find((k) => k.text === text);
  if (!hit) throw new Error(`no known text ${text}`);
  return hit;
};

/**
 * Max distance in px between the highlight over each text and the text's true box (the fixture
 * manifest rect, in PDF points, mapped to the screen through the page element's own box).
 */
async function rectError(page: Page, items: Known[]) {
  return page.evaluate((list) => {
    let worst = 0;
    const detail: string[] = [];
    for (const k of list) {
      const el = document.querySelector<HTMLElement>(`.mr-page[data-page="${k.pageIndex}"]`);
      if (!el) throw new Error("page not mounted");
      const box = el.getBoundingClientRect();
      const rot = Number(el.dataset.rotation);
      const zoom = Number(document.querySelector(".mr-viewer")?.getAttribute("data-zoom-percent"));
      const scale = (zoom / 100) * (96 / 72);
      const odd = rot === 90 || rot === 270;
      const w = (odd ? box.height : box.width) / scale;
      const h = (odd ? box.width : box.height) / scale;
      const turn = (x: number, y: number): [number, number] =>
        rot === 90 ? [h - y, x] : rot === 180 ? [w - x, h - y] : rot === 270 ? [y, w - x] : [x, y];
      const [ax, ay] = turn(k.rect[0], k.rect[1]);
      const [bx, by] = turn(k.rect[2], k.rect[3]);
      const exp = {
        left: box.left + Math.min(ax, bx) * scale,
        right: box.left + Math.max(ax, bx) * scale,
        top: box.top + Math.min(ay, by) * scale,
        bottom: box.top + Math.max(ay, by) * scale,
      };
      const cx = (exp.left + exp.right) / 2;
      const cy = (exp.top + exp.bottom) / 2;
      const rect = [...el.querySelectorAll<HTMLElement>(".mr-annot")]
        .map((n) => n.getBoundingClientRect())
        .find((r) => cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom);
      if (!rect) throw new Error(`no highlight over ${k.text}`);
      const d = [
        Math.abs(rect.left - exp.left),
        Math.abs(rect.right - exp.right),
        Math.abs(rect.top - exp.top),
        Math.abs(rect.bottom - exp.bottom),
      ];
      detail.push(d.map((v) => v.toFixed(2)).join("/"));
      worst = Math.max(worst, ...d);
    }
    return { worst, detail };
  }, items);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  userId = data.user.id;
  mkdirSync(EVIDENCE, { recursive: true });
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

test("highlight by selection and keys 1-3, saved, still aligned after reload at 50-300%", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.getByTestId("upload-input").setInputFiles(pdf("ruler"));
  await expect(page).toHaveURL(/\/app\/read\/[0-9a-f-]{36}$/);
  rulerId = page.url().split("/").pop() ?? "";
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await page.locator(".mr-page").first().waitFor();
  await expect(page.locator(".mr-textlayer > span").first()).toBeAttached();
  await setZoom(page, 100);
  await page.evaluate(() => document.querySelector(".mr-scroller")?.scrollTo(0, 0));

  await selectText(page, 0, L1);
  await expect(page.getByTestId("color-key")).toHaveAttribute("title", "Key idea (1)");
  await page.keyboard.press("1");
  await expect(page.getByTestId("highlight-rect")).toHaveCount(1);
  await selectText(page, 0, L2);
  await page.keyboard.press("3");
  await selectText(page, 0, L3);
  await page.keyboard.press("2");
  await expect(page.getByTestId("highlight-rect")).toHaveCount(3);
  await expect(page.getByTestId("annotation-popover")).toHaveCount(0);

  const perf = await page.evaluate(() => ({
    visible: performance.getEntriesByName("annotation-create-visible").map((e) => e.duration),
    painted: performance.getEntriesByName("annotation-create-painted").map((e) => e.duration),
  }));
  console.log(
    `CREATE_VISIBLE_MS ${perf.visible.map((v) => v.toFixed(1)).join(", ")} | painted ${perf.painted.map((v) => v.toFixed(1)).join(", ")}`,
  );
  expect(perf.visible).toHaveLength(3);
  for (const ms of perf.visible) expect(ms).toBeLessThan(50);

  await settled(page);
  const rows = await annotationRows();
  expect(rows).toHaveLength(3);
  expect(rows.map((r) => r.color).sort()).toEqual(["definition", "example", "key"]);
  expect(rows.map((r) => r.quote_text).sort()).toEqual([L1, L2, L3].sort());
  expect(rows.every((r) => r.kind === "highlight" && r.page_start === 0)).toBe(true);

  await page.reload();
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await expect(page.getByTestId("highlight-rect")).toHaveCount(3);
  let worst = 0;
  for (const zoom of [50, 100, 200, 300]) {
    await setZoom(page, zoom);
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".mr-scroller");
      const target = document.querySelector<HTMLElement>(".mr-annot");
      if (el && target) el.scrollTop += target.getBoundingClientRect().top - 200;
    });
    await page.waitForTimeout(300);
    const { worst: w, detail } = await rectError(
      page,
      [L1, L2, L3].map((t) => known("ruler", t)),
    );
    console.log(
      `RECT_ERR_PX zoom ${zoom}%: ${w.toFixed(2)} (l/r/t/b per line ${detail.join(" | ")})`,
    );
    worst = Math.max(worst, w);
  }
  console.log(`RECT_ERR_PX_MAX ruler: ${worst.toFixed(2)}`);
  expect(worst).toBeLessThanOrEqual(1);
});

test("rotated pages: highlights sit on the text at every rotation", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.getByTestId("upload-input").setInputFiles(pdf("mixed-pages"));
  await expect(page).toHaveURL(/\/app\/read\/[0-9a-f-]{36}$/);
  mixedId = page.url().split("/").pop() ?? "";
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await setZoom(page, 100);
  let worst = 0;
  const targets = [
    [1, "Page 2 of 6: A4, Rotate 90"],
    [2, "Page 3 of 6: A5, Rotate 180"],
    [3, "Page 4 of 6: US Legal, Rotate 270"],
  ] as const;
  for (const [index, text] of targets) {
    await page.evaluate((i) => {
      const slot = document.querySelector<HTMLElement>(`.mr-page[data-page="${i}"]`);
      const scroller = document.querySelector<HTMLElement>(".mr-scroller");
      if (slot && scroller) {
        scroller.scrollTop +=
          slot.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      }
    }, index);
    await expect(
      page.locator(`.mr-page[data-page="${index}"] .mr-textlayer > span`).first(),
    ).toBeAttached();
    await page.waitForTimeout(300);
    await selectText(page, index, text);
    await page.keyboard.press(String(index));
    await expect(page.locator(`.mr-page[data-page="${index}"] .mr-annot`)).toHaveCount(1);
    const { worst: w, detail } = await rectError(page, [known("mixed-pages", text)]);
    console.log(`RECT_ERR_PX rotated page ${index + 1}: ${w.toFixed(2)} (${detail.join(" | ")})`);
    worst = Math.max(worst, w);
  }
  console.log(`RECT_ERR_PX_MAX rotated: ${worst.toFixed(2)}`);
  expect(worst).toBeLessThanOrEqual(1);
  await settled(page);
  const second = (await annotationRows()).find((r) => r.page_start === 1);
  expect(second?.document_id).toBe(mixedId);
});

test("edit color and comment, delete, undo and redo", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  await page.goto(`/app/read/${rulerId}`);
  await expect(page.getByTestId("highlight-rect")).toHaveCount(3);
  await setZoom(page, 100);
  await page.evaluate(() => document.querySelector(".mr-scroller")?.scrollTo(0, 0));
  const rects = page.locator('.mr-annot[data-color="key"]');
  const box = await rects.first().boundingBox();
  if (!box) throw new Error("no key highlight");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("annotation-popover")).toHaveAttribute("data-mode", "edit");

  await page.getByTestId("color-memorize").click();
  await expect(page.locator('.mr-annot[data-color="memorize"]')).toHaveCount(1);
  await page.keyboard.press("n");
  await expect(page.getByTestId("comment-input")).toBeFocused();
  await page.keyboard.type("Remember this one");
  await expect(page.getByTestId("comment-marker")).toBeVisible();
  await settled(page);
  await expect
    .poll(async () => (await annotationRows()).find((r) => r.comment)?.comment)
    .toBe("Remember this one");
  expect((await annotationRows()).filter((r) => r.color === "memorize")).toHaveLength(1);

  // Delete and undo.
  await page.keyboard.press("Escape"); // leaves the comment field
  await expect(page.getByTestId("annotation-popover")).toHaveCount(0);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("annotation-popover")).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("highlight-rect")).toHaveCount(2);
  await settled(page);
  expect((await annotationRows()).filter((r) => r.deleted_at !== null)).toHaveLength(1);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("highlight-rect")).toHaveCount(3);
  await expect(page.getByTestId("comment-marker")).toBeVisible();
  await settled(page);
  expect((await annotationRows()).filter((r) => r.deleted_at !== null)).toHaveLength(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByTestId("highlight-rect")).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("highlight-rect")).toHaveCount(3);

  // J / K walk the highlights.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const activeBefore = await page
    .locator('.mr-annot[data-active="true"]')
    .first()
    .getAttribute("data-annotation-id");
  await page.keyboard.press("j");
  await expect
    .poll(() =>
      page.locator('.mr-annot[data-active="true"]').first().getAttribute("data-annotation-id"),
    )
    .not.toBe(activeBefore);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("annotation-popover")).toHaveCount(0);
  await settled(page);
});

test("bookmarks: B toggles a ribbon and a list entry", async ({ page }) => {
  await signIn(page);
  await page.goto(`/app/read/${rulerId}`);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await page.keyboard.press("b");
  await expect(page.getByTestId("bookmark-ribbon")).toBeVisible();
  await page.getByTestId("bookmarks-toggle").click();
  await expect(page.getByTestId("bookmark-item")).toHaveText("Page 1");
  await settled(page);
  const bookmark = (await annotationRows()).find((r) => r.kind === "bookmark" && !r.deleted_at);
  expect(bookmark?.page_start).toBe(0);
  await page.keyboard.press("b");
  await expect(page.getByTestId("bookmark-ribbon")).toHaveCount(0);
  await expect(page.getByTestId("bookmark-item")).toHaveCount(0);
  await page.keyboard.press("b");
  await expect(page.getByTestId("bookmark-ribbon")).toBeVisible();
  await settled(page);
});

test("#a= deep link opens at the highlight and flashes it", async ({ page }) => {
  await signIn(page);
  const target = (await annotationRows()).find((r) => r.page_start === 3 && !r.deleted_at);
  if (!target) throw new Error("no highlight on page 4");
  await page.goto(`/app/read/${mixedId}#a=${target.id}`);
  const rect = page.locator(`.mr-annot[data-annotation-id="${target.id}"]`).first();
  await expect(rect).toBeAttached();
  await expect(rect).toHaveAttribute("data-flash", "true");
  await expect
    .poll(() =>
      rect.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      }),
    )
    .toBe(true);
  await expect(page.getByTestId("page-indicator")).toHaveText(/^4 \//);
  await expect(rect).not.toHaveAttribute("data-flash", "true", { timeout: 4000 });
});

test("a second browser context sees the saved highlights; themes", async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await signIn(page);
  await page.goto(`/app/read/${rulerId}`);
  await expect(page.getByTestId("highlight-rect")).toHaveCount(3);
  await expect(page.getByTestId("comment-marker")).toBeVisible();
  await page.evaluate(() => document.querySelector(".mr-scroller")?.scrollTo(0, 0));
  for (const theme of ["Light", "Sepia", "Dark"]) {
    await page.getByRole("radio", { name: theme }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${EVIDENCE}/highlights-${theme.toLowerCase()}.png` });
  }
  await context.close();
});
