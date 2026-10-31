import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  admin,
  createUser,
  deleteUser,
  pdf,
  selectText,
  signIn,
  type TestUser,
} from "./p12-helpers";

// C1 (ADR 0004): mark chapters as done. Sidebar checks, parent/child rules, header button, D key,
// palette, "Done & next", the auto-mark setting, guessed headings, library card + sort, reading
// status, two devices, offline, export. Until the new sync stream is deployed in the PowerSync
// dashboard, marks do not sync DOWN to another device, so cross-device checks go through the server.

const EVIDENCE = "../../evidence/c1-chapter-progress";
mkdirSync(EVIDENCE, { recursive: true });

test.describe.configure({ mode: "serial" });

let user: TestUser;
let paperId = "";
let headingsId = "";

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

async function openReader(page: Page, id: string, hash = "") {
  await page.goto(`/app/read/${id}${hash}`);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
}

async function openSidebar(page: Page) {
  if ((await page.getByTestId("reader-rail").count()) === 0) {
    await page.getByTestId("sidebar-toggle").click();
  }
  await page.getByRole("tab", { name: "Chapters" }).click();
}

const checks = (page: Page) => page.getByTestId("chapter-check");
const done = (loc: ReturnType<Page["locator"]>) => expect(loc).toHaveAttribute("data-done", "true");
const notDone = (loc: ReturnType<Page["locator"]>) =>
  expect(loc).toHaveAttribute("data-done", "false");

/** Waits until this browser has no local change left to send (ps_crud is the upload queue). */
const uploaded = (page: Page) =>
  expect
    .poll(
      () =>
        page.evaluate(async () => {
          const margin = (
            window as unknown as {
              __margin?: { db: () => import("@powersync/web").PowerSyncDatabase };
            }
          ).__margin;
          if (!margin) return 1; // the data layer is not loaded yet
          const { db } = margin;
          const rows = await db().getAll<{ n: number }>("SELECT COUNT(*) AS n FROM ps_crud");
          return rows[0]?.n ?? 0;
        }),
      { timeout: 25_000 },
    )
    .toBe(0);

type ServerMark = {
  id: string;
  document_id: string;
  chapter_key: string;
  title: string;
  page_start: number;
  done_at: string | null;
  source: string;
  deleted_at: string | null;
};
async function serverMarks(documentId?: string): Promise<ServerMark[]> {
  let q = admin
    .from("chapter_progress")
    .select("id, document_id, chapter_key, title, page_start, done_at, source, deleted_at")
    .eq("user_id", user.id);
  if (documentId) q = q.eq("document_id", documentId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}
const serverDone = async (documentId: string) =>
  (await serverMarks(documentId)).filter((m) => m.done_at !== null);

async function serverStatus(documentId: string): Promise<string | null> {
  const { data } = await admin
    .from("documents")
    .select("reading_status")
    .eq("id", documentId)
    .single();
  return (data?.reading_status as string | null) ?? null;
}

/** Row indexes that count as chapters: the top level, plus the second when there are few parts. */
const counted = (shape: { depth: number }[]) => {
  const top = shape.flatMap((r, i) => (r.depth === 0 ? [i] : []));
  return top.length >= 6 ? top : shape.flatMap((r, i) => (r.depth <= 1 ? [i] : []));
};

/** Depth of each chapter row (from its indent) and whether it has children, with all rows open. */
async function expandAll(page: Page) {
  for (let i = 0; i < 40; i++) {
    const open = page.getByRole("button", { name: "Expand section" });
    if ((await open.count()) === 0) break;
    await open.first().click();
  }
}
async function rowShape(page: Page) {
  return page.getByTestId("chapter-row").evaluateAll((rows) =>
    rows.map((row) => ({
      depth: Math.round((Number.parseFloat((row as HTMLElement).style.paddingLeft) - 0.25) / 0.9),
      hasKids: row.querySelector('[aria-label="Collapse section"]') !== null,
      hasCheck: row.querySelector('[data-testid="chapter-check"]') !== null,
    })),
  );
}

// Until the updated powersync.yaml is deployed in the PowerSync dashboard, the server's stream does
// not carry chapter_progress. A mark then uploads fine but vanishes from the local database once the
// upload is confirmed (the stream "wins"). So the behavior tests below work OFFLINE, where the local
// database is the source of truth, and read the server only after reconnecting. The last test probes
// whether the stream is deployed and, when it is, also checks reload and a second device.
const goOffline = async (page: Page) => {
  await page.context().setOffline(true);
  await expect(page.getByTestId("sync-status").first()).toHaveAttribute("data-state", "offline");
};
const goOnline = async (page: Page) => {
  await page.context().setOffline(false);
  await uploaded(page);
};
const goHash = (page: Page, hash: string) => page.evaluate((h) => (location.hash = h), hash);

type LocalMark = { chapter_key: string; done_at: string | null; source: string };
const localMarks = (page: Page): Promise<LocalMark[]> =>
  page.evaluate(async () => {
    const { db } = (
      window as unknown as { __margin: { db: () => import("@powersync/web").PowerSyncDatabase } }
    ).__margin;
    return db().getAll<LocalMark>("SELECT chapter_key, done_at, source FROM chapter_progress");
  });
const localDone = async (page: Page) => (await localMarks(page)).filter((m) => m.done_at !== null);

test.beforeAll(async () => {
  user = await createUser("c1");
});
test.afterAll(async () => {
  await deleteUser(user);
});

test("setup: upload a book with an outline and one without", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, user);
  paperId = await upload(page, pdf("two-column-paper"));
  headingsId = await upload(page, { name: "headings.pdf", buffer: await headingsPdf() });
});

test("sidebar: tick shows in under 50 ms; parent and child rules; one undo step; reaches the server", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, user);
  await openReader(page, paperId);
  await openSidebar(page);
  await expandAll(page);
  const shape = await rowShape(page);
  expect(shape.length).toBe(12);
  expect(shape.every((r) => r.hasCheck)).toBe(true);
  await expect(checks(page)).toHaveCount(12);
  await goOffline(page);

  // A leaf first: the local write is visible at once.
  const leafIndex = shape.findIndex((r) => !r.hasKids);
  const leaf = checks(page).nth(leafIndex);
  await notDone(leaf);
  const ms = await leaf.evaluate(async (el) => {
    const t0 = performance.now();
    (el as HTMLElement).click();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    return el.getAttribute("data-done") === "true"
      ? performance.now() - t0
      : Number.POSITIVE_INFINITY;
  });
  console.log(`[c1] tick visible after ${ms.toFixed(1)} ms`);
  expect(ms).toBeLessThan(50);
  await done(leaf);
  await expect(page.getByText(/Marked ".*" as done/)).toBeVisible();
  await expect.poll(async () => (await localDone(page)).length).toBe(1);
  await page.screenshot({ path: `${EVIDENCE}/sidebar-leaf-checked-desktop.png` });

  // Parent rule: checking a parent checks its children, as one undo step.
  const parentIndex = shape.findIndex((r) => r.hasKids);
  const parentDepth = shape[parentIndex]?.depth ?? 0;
  const kids: number[] = [];
  for (let i = parentIndex + 1; i < shape.length && (shape[i]?.depth ?? 0) > parentDepth; i++) {
    if (shape[i]?.depth === parentDepth + 1) kids.push(i);
  }
  expect(kids.length).toBeGreaterThan(0);
  for (const i of [parentIndex, ...kids]) {
    if ((await checks(page).nth(i).getAttribute("data-done")) === "true") {
      await checks(page).nth(i).click();
    }
  }
  await checks(page).nth(parentIndex).click();
  await done(checks(page).nth(parentIndex));
  for (const i of kids) await done(checks(page).nth(i));
  await page.screenshot({ path: `${EVIDENCE}/sidebar-parent-checked-desktop.png` });
  await page.getByRole("button", { name: "Undo" }).click();
  await notDone(checks(page).nth(parentIndex));
  for (const i of kids) await notDone(checks(page).nth(i));

  // All children done: the parent follows. Clearing one child clears the parent again.
  for (const i of kids) await checks(page).nth(i).click();
  await done(checks(page).nth(parentIndex));
  if (kids.length > 1) await expect(page.getByTestId("chapter-partial")).toHaveCount(0);
  await checks(page)
    .nth(kids[0] as number)
    .click();
  await notDone(checks(page).nth(parentIndex));
  await notDone(checks(page).nth(kids[0] as number));
  if (kids.length > 1) {
    await expect(page.getByTestId("chapter-partial")).toContainText(
      `${kids.length - 1}/${kids.length} done`,
    );
  }

  // Back online: the marks upload. Un-marking sets done_at to null; the row is not soft-deleted.
  await goOnline(page);
  await expect.poll(async () => (await serverMarks(paperId)).length).toBeGreaterThan(1);
  const marks = await serverMarks(paperId);
  expect(marks.every((m) => m.deleted_at === null && m.source === "manual")).toBe(true);
  expect(marks.some((m) => m.done_at !== null)).toBe(true);
  expect(marks.some((m) => m.done_at === null)).toBe(true);
  expect(marks.every((m) => /^o:[\d.]+:/.test(m.chapter_key))).toBe(true);
});

test("header button, D key, palette, shortcut sheet; Done & next at the end of a chapter; nothing is marked automatically", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, user);
  await openReader(page, headingsId);
  await openSidebar(page);
  // Guessed headings (no outline) get checks too.
  await expect(page.getByTestId("chapter-row")).toHaveCount(3, { timeout: 30_000 });
  await expect(checks(page)).toHaveCount(3);
  await expect(page.getByTestId("chapters-detected")).toBeVisible();
  await goOffline(page);
  const button = page.getByTestId("chapter-done-button");
  await expect(button).toBeVisible();
  await notDone(button);

  // Header button.
  await button.click();
  await done(button);
  await done(checks(page).nth(0));
  await button.click();
  await notDone(button);

  // D key (focus is on the page, not a field).
  await page
    .locator(".mr-textlayer")
    .first()
    .click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("d");
  await done(button);
  await page.keyboard.press("d");
  await notDone(button);

  // Palette.
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("Mark chapter as done");
  await page.getByRole("option", { name: /Mark chapter as done/ }).click();
  await done(button);
  await button.click();
  await notDone(button);

  // Shortcut sheet lists D.
  await page.keyboard.press("?");
  await expect(page.getByTestId("shortcut-sheet")).toContainText(
    "Mark the current chapter as done",
  );
  await page.keyboard.press("Escape");

  // Chapter 1 spans pages 1-2: on page 2 the pill offers "Done & next".
  await goHash(page, "#p=2");
  await expect(page.getByTestId("done-and-next")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("next-chapter")).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/done-and-next-desktop.png` });
  // Reaching the last page marked nothing by itself (the setting is off).
  await notDone(page.getByTestId("chapter-done-button"));
  expect(await localDone(page)).toHaveLength(0);
  await page.getByTestId("done-and-next").click();
  await expect(page.getByTestId("chapter-title")).toContainText("Chapter 2");
  await done(checks(page).nth(0));
  await notDone(checks(page).nth(1));
  await expect.poll(async () => (await localDone(page)).length).toBe(1);

  await goOnline(page);
  await expect.poll(async () => (await serverDone(headingsId)).length).toBe(1);
  const mark = (await serverDone(headingsId))[0] as ServerMark;
  expect(mark.chapter_key).toMatch(/^d:0:chapter-1/); // guessed headings are keyed by page
  expect(mark.source).toBe("manual");
});

test("a Confusing highlight shows 'to clarify' on its chapter row", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, user);
  await openReader(page, headingsId);
  await selectText(page, 0, "of ordinary body text on page 1");
  await page.keyboard.press("5");
  await expect(page.getByTestId("highlight-rect").first()).toBeVisible();
  await openSidebar(page);
  const first = page.getByTestId("chapter-row").nth(0);
  await expect(first.getByTestId("chapter-clarify")).toContainText("1 to clarify");
  await expect(page.getByTestId("chapter-row").nth(1).getByTestId("chapter-clarify")).toHaveCount(
    0,
  );
  await page.screenshot({ path: `${EVIDENCE}/to-clarify-desktop.png` });
});

test("auto-mark is off by default; the setting marks on the last page with source auto", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, user);
  await page.goto("/app/settings");
  const box = page.getByTestId("auto-mark-chapters");
  await expect(box).toBeVisible();
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(box).toBeChecked();
  await uploaded(page);
  await page.reload();
  await expect(page.getByTestId("auto-mark-chapters")).toBeChecked();

  // Chapter 3 holds the last page. Read to it (offline, so the local marks stay visible).
  await openReader(page, headingsId);
  await expect(page.getByTestId("chapter-done-button")).toBeVisible();
  await goOffline(page);
  await page
    .locator(".mr-textlayer")
    .first()
    .click({ position: { x: 2, y: 2 } });
  await goHash(page, "#p=4");
  await expect(page.getByTestId("chapter-title")).toContainText("Chapter 3");
  await expect(page.getByTestId("chapter-done-button")).toHaveAttribute("data-done", "true", {
    timeout: 20_000,
  });
  const auto = (await localDone(page)).filter((m) => m.source === "auto");
  expect(auto).toHaveLength(1);
  await openSidebar(page);
  await expect(checks(page).nth(2)).toHaveAttribute("data-auto", "true");
  await goOnline(page);
  await expect
    .poll(
      async () => (await serverDone(headingsId)).find((m) => m.title.includes("Chapter 3"))?.source,
    )
    .toBe("auto");

  // Turn it off again so later steps are unaffected.
  await page.goto("/app/settings");
  await page.getByTestId("auto-mark-chapters").uncheck();
  await uploaded(page);
});

test("library: 'N of M chapters' and the segmented bar", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, user);
  const paperCard = () =>
    page.getByTestId("book").filter({ has: page.locator(`a[href="/app/read/${paperId}"]`) });

  await openReader(page, paperId);
  await openSidebar(page);
  await expandAll(page);
  const shape = await rowShape(page);
  const topIndexes = counted(shape);
  expect(topIndexes.length).toBeGreaterThan(2);
  await goOffline(page);
  // Two top-level chapters, then the library (client-side navigation keeps the local database).
  // Two leaves (a parent would tick its whole subtree), then count what the sidebar shows as done.
  const leaves = topIndexes.filter((i) => !shape[i]?.hasKids);
  for (const i of leaves.slice(0, 2)) await checks(page).nth(i).click();
  let doneCount = 0;
  for (const i of topIndexes) {
    if ((await checks(page).nth(i).getAttribute("data-done")) === "true") doneCount++;
  }
  expect(doneCount).toBeGreaterThanOrEqual(2);
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(paperCard().getByTestId("book-chapters")).toHaveText(
    `${doneCount} of ${topIndexes.length} chapters`,
  );
  const segments = paperCard().getByTestId("chapter-segments");
  await expect(segments.locator("> div")).toHaveCount(topIndexes.length);
  await expect(segments.locator('[data-filled="true"]')).toHaveCount(doneCount);
  await page.screenshot({ path: `${EVIDENCE}/library-partial-desktop.png` });

  await goOnline(page);
});

test("library: Finished when every chapter is done, sort by progress, reading status and filter", async ({
  page,
}) => {
  test.setTimeout(150_000);
  // The other book is read about 10 % by pages; the paper's chapters will be 100 % done, while its
  // own page percent stays near 0: only a chapter-based sort puts the paper first.
  await admin.from("reading_state").update({ percent: 10 }).eq("document_id", headingsId);
  await signIn(page, user);
  const paperCard = () =>
    page.getByTestId("book").filter({ has: page.locator(`a[href="/app/read/${paperId}"]`) });
  const otherCard = () =>
    page.getByTestId("book").filter({ hasNot: page.locator(`a[href="/app/read/${paperId}"]`) });

  // Start with no status on the paper (earlier steps finished it), so Finished must come from here.
  const paperTitle = (await paperCard().getByTestId("book-title").textContent()) ?? "";
  if ((await paperCard().getByTestId("book-status").count()) > 0) {
    await paperCard()
      .getByRole("button", { name: `Menu for ${paperTitle}` })
      .click();
    await page.getByTestId("mark-clear").click();
    await uploaded(page);
    await expect.poll(async () => serverStatus(paperId)).toBeNull();
  }
  await openReader(page, paperId);
  await openSidebar(page);
  await expandAll(page);
  const shape = await rowShape(page);
  const topIndexes = counted(shape);
  await goOffline(page);
  for (const i of topIndexes) {
    if ((await checks(page).nth(i).getAttribute("data-done")) === "false") {
      await checks(page).nth(i).click();
    }
  }
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(paperCard().getByTestId("book-chapters")).toHaveText(
    `${topIndexes.length} of ${topIndexes.length} chapters`,
  );
  await expect(paperCard().getByTestId("book-status")).toHaveText("Finished");
  await expect(
    paperCard().locator('[data-testid="chapter-segments"] [data-filled="true"]'),
  ).toHaveCount(topIndexes.length);
  await page.screenshot({ path: `${EVIDENCE}/library-finished-desktop.png` });

  // Sort by Progress uses chapters done: the finished book (100 %) comes first.
  await page.getByLabel("Sort").selectOption("progress");
  await expect(page.getByTestId("book-title").first()).toHaveText(paperTitle);

  // Reading status from the book menu, badge and filter.
  const otherTitle = (await otherCard().getByTestId("book-title").textContent()) ?? "";
  await otherCard()
    .getByRole("button", { name: `Menu for ${otherTitle}` })
    .click();
  await page.getByTestId("mark-reading").click();
  await expect(otherCard().getByTestId("book-status")).toHaveText("Reading");
  await page.getByTestId("status-filter").selectOption("reading");
  await expect(page.getByTestId("book")).toHaveCount(1);
  await expect(otherCard()).toBeVisible();
  await page.getByTestId("status-filter").selectOption("finished");
  await expect(page.getByTestId("book")).toHaveCount(1);
  await expect(paperCard()).toBeVisible();
  await page.getByTestId("status-filter").selectOption("all");
  await page.screenshot({ path: `${EVIDENCE}/library-status-desktop.png` });

  await goOnline(page);
  await expect.poll(async () => serverStatus(paperId)).toBe("finished");
  await expect.poll(async () => serverStatus(headingsId)).toBe("reading");

  // Clear the status again (sync-backed, so it survives the stream not carrying chapter marks).
  await otherCard()
    .getByRole("button", { name: `Menu for ${otherTitle}` })
    .click();
  await page.getByTestId("mark-clear").click();
  await expect(otherCard().getByTestId("book-status")).toHaveCount(0);
  await uploaded(page);
  await expect.poll(async () => serverStatus(headingsId)).toBeNull();
});

test("two contexts tick the same chapter: one server row; an offline tick uploads after reconnecting", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const open = async (): Promise<[BrowserContext, Page]> => {
    const ctx = await (browser as Browser).newContext();
    const page = await ctx.newPage();
    await signIn(page, user);
    await openReader(page, headingsId);
    await openSidebar(page);
    await expect(page.getByTestId("chapter-row")).toHaveCount(3, { timeout: 30_000 });
    return [ctx, page];
  };
  const [ctxA, a] = await open();
  const [ctxB, b] = await open();
  const chapter2 = async () =>
    (await serverMarks(headingsId)).filter((m) => m.title.includes("Chapter 2"));
  expect(await chapter2()).toHaveLength(0);

  await goOffline(b);
  await checks(b).nth(1).click();
  await done(checks(b).nth(1)); // offline: shown from local storage
  expect(await chapter2()).toHaveLength(0); // not uploaded yet
  await checks(a).nth(1).click();
  await uploaded(a);
  await expect.poll(async () => (await chapter2()).length).toBe(1);
  await goOnline(b);
  // Both devices wrote the same deterministic row id: still exactly one row, done.
  await expect.poll(async () => (await chapter2())[0]?.done_at !== null).toBe(true);
  expect(await chapter2()).toHaveLength(1);
  const ids = (await serverMarks(headingsId)).map((m) => m.id);
  expect(new Set(ids).size).toBe(ids.length);
  await ctxA.close();
  await ctxB.close();
});

test("export: Markdown frontmatter shows chapters_done; the backup includes the table; axe; phone", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  await signIn(page, user);
  await openReader(page, paperId);
  await openSidebar(page);
  await expandAll(page);
  const shape = await rowShape(page);
  const topIndexes = counted(shape);
  await goOffline(page);
  for (const i of topIndexes.filter((j) => !shape[j]?.hasKids).slice(0, 2)) {
    await checks(page).nth(i).click();
  }
  const download = page.waitForEvent("download");
  await page.getByTestId("export-menu").click();
  await page.getByTestId("export-markdown").click();
  const file = join(EVIDENCE, "paper.md");
  await (await download).saveAs(file);
  const md = readFileSync(file, "utf8");
  expect(md).toMatch(new RegExp(`^chapters_done: \\d+/${topIndexes.length}$`, "m"));

  // Axe on the reader sidebar with checks.
  let results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  await goOnline(page);

  // "Export everything" reads the server's rows, which now hold the marks.
  await expect.poll(async () => (await serverDone(paperId)).length).toBeGreaterThan(0);
  await page.goto("/app/settings");
  const zipDownload = page.waitForEvent("download");
  await page.getByTestId("export-everything").click();
  const zipPath = join(EVIDENCE, "export-everything.zip");
  await (await zipDownload).saveAs(zipPath);
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
  const dump = JSON.parse(strFromU8(files["margin-data.json"] as Uint8Array)) as {
    tables: Record<string, unknown[]>;
  };
  expect(dump.tables.chapter_progress?.length).toBeGreaterThan(0);

  await page.goto("/app");
  await expect(page.getByTestId("book").first()).toBeVisible();
  results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);

  // Phone: touch targets of at least 44 px, screenshots, axe.
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const phone = await ctx.newPage();
  await signIn(phone, user);
  await expect(phone.getByTestId("book").first()).toBeVisible();
  await phone.screenshot({ path: `${EVIDENCE}/library-phone.png` });
  await openReader(phone, paperId);
  await phone.getByTestId("sidebar-toggle").click();
  await phone.getByRole("tab", { name: "Chapters" }).click();
  const first = phone.getByTestId("chapter-check").first();
  await expect(first).toBeVisible();
  const box = await first.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await phone.screenshot({ path: `${EVIDENCE}/sidebar-phone.png` });
  results = await new AxeBuilder({ page: phone }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  await ctx.close();
});

test("sync stream: marks survive a reload and appear on a second device (needs the deployed stream)", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await signIn(a, user);
  await openReader(a, headingsId);
  await openSidebar(a);
  await expect(a.getByTestId("chapter-row")).toHaveCount(3, { timeout: 30_000 });
  // Chapter 3 is not ticked on the server yet unless an earlier test left it; use the one still open.
  const target = (await serverDone(headingsId)).map((m) => m.title).join(" ");
  const index = [0, 1, 2].find((i) => !target.includes(`Chapter ${i + 1}`));
  test.skip(index === undefined, "every chapter is already ticked");
  await checks(a)
    .nth(index as number)
    .click();
  await uploaded(a);
  await a.waitForTimeout(4000);
  const stillThere = (await localDone(a)).length > 0;
  test.info().annotations.push({
    type: "stream",
    description: stillThere
      ? "chapter_progress stream is deployed"
      : "chapter_progress stream NOT deployed: marks vanish locally after upload",
  });
  console.log(`[c1] chapter_progress stream deployed: ${stillThere}`);
  test.skip(!stillThere, "the updated powersync.yaml is not deployed yet (founder step)");

  await a.reload();
  await expect(a.locator(".mr-canvas").first()).toBeVisible();
  await openSidebar(a);
  await done(checks(a).nth(index as number));

  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await signIn(b, user);
  await openReader(b, headingsId);
  await openSidebar(b);
  await done(checks(b).nth(index as number));
  await checks(a)
    .nth(index as number)
    .click();
  await expect(checks(b).nth(index as number)).toHaveAttribute("data-done", "false", {
    timeout: 2000,
  }); // live, inside 2 s
  await ctxA.close();
  await ctxB.close();
});
