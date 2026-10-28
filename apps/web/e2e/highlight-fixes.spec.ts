import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Highlight fixes, driven with real pointer events (mouse drags, double and triple clicks, clicks
// on existing highlights): delete, no spill onto the next line, highlights never overlap.

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

const email = `e2e-hlfix-${randomUUID()}@example.com`;
const password = `pw-${randomUUID()}`;
let userId = "";

const L1 = "Line one of the ruler paragraph begins exactly at x = 72 pt.";
const L2 = "Every line in this block uses 11 pt Helvetica with 15 pt leading.";
const L3 = "Highlights that span several lines must stay aligned at any zoom.";

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function openFixture(page: Page, id: string) {
  await signIn(page);
  await page.getByTestId("upload-input").setInputFiles(pdf(id));
  await expect(page).toHaveURL(/\/app\/read\/[0-9a-f-]{36}$/);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  return page.url().split("/").pop() ?? "";
}

async function rows(documentId: string) {
  const { data } = await admin
    .from("annotations")
    .select("id, kind, color, comment, quote_text, page_start, deleted_at, target")
    .eq("user_id", userId)
    .eq("document_id", documentId)
    .eq("kind", "highlight")
    .order("created_at");
  return (data ?? []).filter((r) => r.deleted_at === null);
}

const settled = (page: Page) =>
  expect(page.getByTestId("pending-writes")).toHaveText("0", { timeout: 15_000 });

/** Scrolls the span with `text` into view and returns the client box of [from, to) inside it. */
async function textBox(
  page: Page,
  pageIndex: number,
  text: string,
  part?: { from: number; to: number },
): Promise<Box> {
  const sel = `.mr-page[data-page="${pageIndex}"] .mr-textlayer > span`;
  // Pages far from the top are not mounted yet: scroll roughly there first.
  await page.evaluate((i) => {
    const scroller = document.querySelector(".mr-scroller");
    const count = Number(document.querySelector(".mr-viewer")?.getAttribute("data-page-count"));
    if (scroller && count && !document.querySelector(`.mr-page[data-page="${i}"]`)) {
      scroller.scrollTop = (scroller.scrollHeight * i) / count;
    }
  }, pageIndex);
  await expect(page.locator(sel).first()).toBeAttached({ timeout: 20_000 });
  const box = await page.evaluate(
    ([selector, t, p]) => {
      const spans = [...document.querySelectorAll<HTMLElement>(selector as string)];
      const span =
        spans.find((s) => s.textContent === t) ??
        spans.find((s) => s.textContent?.includes(t as string));
      if (!span) return null;
      const view = document.querySelector(".mr-scroller")?.getBoundingClientRect();
      const pos = span.getBoundingClientRect();
      if (!view || pos.top < view.top + 120 || pos.bottom > view.bottom - 120) {
        span.scrollIntoView({ block: "center" });
      }
      const node = span.firstChild as Text;
      const range = document.createRange();
      const part = p as { from: number; to: number } | null;
      const at = (span.textContent ?? "").indexOf(t as string);
      range.setStart(node, part ? at + part.from : 0);
      range.setEnd(node, part ? at + part.to : (span.textContent ?? "").length);
      const r = range.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    },
    [sel, text, part ?? null] as const,
  );
  if (!box) throw new Error(`no span for ${text}`);
  await page.waitForTimeout(250);
  // Scrolling may have moved it: measure again.
  return page.evaluate(
    ([selector, t, p]) => {
      const spans = [...document.querySelectorAll<HTMLElement>(selector as string)];
      const span =
        spans.find((s) => s.textContent === t) ??
        spans.find((s) => s.textContent?.includes(t as string));
      const node = span?.firstChild as Text;
      const range = document.createRange();
      const part = p as { from: number; to: number } | null;
      const at = (span?.textContent ?? "").indexOf(t as string);
      range.setStart(node, part ? at + part.from : 0);
      range.setEnd(node, part ? at + part.to : (span?.textContent ?? "").length);
      const r = range.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    },
    [sel, text, part ?? null] as const,
  );
}

/** A real drag across a text box, optionally overshooting to the right (end of line). */
async function dragAcross(page: Page, b: Box, overshoot = 0) {
  const y = (b.top + b.bottom) / 2;
  await page.mouse.move(b.left + 1, y);
  await page.mouse.down();
  await page.mouse.move((b.left + b.right) / 2, y, { steps: 6 });
  await page.mouse.move(b.right - 1 + overshoot, y, { steps: 6 });
  await page.mouse.up();
}

async function highlightWithDrag(
  page: Page,
  pageIndex: number,
  text: string,
  key = "1",
  part?: { from: number; to: number },
) {
  const b = await textBox(page, pageIndex, text, part);
  await dragAcross(page, b);
  await expect(page.getByTestId("annotation-popover")).toHaveAttribute("data-mode", "create");
  await page.keyboard.press(key);
}

const popover = (page: Page) => page.getByTestId("annotation-popover");
const rects = (page: Page) => page.getByTestId("highlight-rect");

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
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

test("bug 1: a click, double click or triple click on a highlight opens it, and Delete removes it", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const documentId = await openFixture(page, "ruler");
  await highlightWithDrag(page, 0, L1);
  await expect(rects(page)).toHaveCount(1);

  const hl = async () => {
    const box = await rects(page).first().boundingBox();
    if (!box) throw new Error("no highlight");
    return box;
  };

  // Plain click.
  let box = await hl();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(popover(page)).toHaveAttribute("data-mode", "edit");
  await page.keyboard.press("Escape");
  await expect(popover(page)).toHaveCount(0);

  // Double click on a word, triple click on the line: still the edit popover.
  box = await hl();
  await page.mouse.dblclick(box.x + box.width / 3, box.y + box.height / 2);
  await expect(popover(page)).toHaveAttribute("data-mode", "edit");
  await page.keyboard.press("Escape");
  await expect(popover(page)).toHaveCount(0);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { clickCount: 3 });
  await expect(popover(page)).toHaveAttribute("data-mode", "edit");

  // A drag over part of it selects text and shows the same edit popover.
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
  const inner = await textBox(page, 0, L1, { from: 5, to: 20 });
  await dragAcross(page, inner);
  await expect(popover(page)).toHaveAttribute("data-mode", "edit");
  expect(
    await page.evaluate(() => document.getSelection()?.toString().length ?? 0),
  ).toBeGreaterThan(3);
  await expect(rects(page)).toHaveCount(1);

  // The delete button is visible and labelled.
  const del = page.getByTestId("popover-delete");
  await expect(del).toBeVisible();
  await expect(del).toContainText("Delete");
  await del.click();
  await expect(rects(page)).toHaveCount(0);
  await expect(popover(page)).toHaveCount(0);
  await settled(page);
  expect(await rows(documentId)).toHaveLength(0);

  // Undo, then Backspace deletes too.
  await page.keyboard.press("Control+z");
  await expect(rects(page)).toHaveCount(1);
  box = await hl();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(popover(page)).toHaveAttribute("data-mode", "edit");
  await page.keyboard.press("Backspace");
  await expect(rects(page)).toHaveCount(0);

  // Delete from the Annotations panel.
  await page.keyboard.press("Control+z");
  await expect(rects(page)).toHaveCount(1);
  await page.keyboard.press("p");
  const item = page.getByTestId("annot-item");
  await expect(item).toHaveCount(1);
  await item.hover();
  await page.getByTestId("annot-delete").click();
  await expect(rects(page)).toHaveCount(0);
  await expect(item).toHaveCount(0);
  await settled(page);
  expect(await rows(documentId)).toHaveLength(0);
});

for (const fixture of [
  {
    id: "two-column-paper",
    page: 1,
    lines: [
      "spectrum. The many-body wavefunction takes the form",
      "matrix, independent of the entangling region.",
    ],
  },
  {
    id: "french-accents-ligatures",
    page: 9,
    lines: [
      "molécules pendant un intervalle de temps, et qu’on passait le film à l’envers, cette évolution",
      "film est passé à l’endroit ou à l’envers.",
    ],
  },
]) {
  test(`bug 2: no spill onto the next line (${fixture.id})`, async ({ page }) => {
    test.setTimeout(150_000);
    const documentId = await openFixture(page, fixture.id);
    await page.waitForTimeout(500);

    const norm = (text: string) => text.normalize("NFKD").replace(/\s+/g, " ");
    type Saved = { quote: string; rects: number[][] };
    const lastSaved = async (): Promise<Saved> => {
      await settled(page);
      const row = (await rows(documentId)).at(-1);
      if (!row) throw new Error("no highlight was saved");
      const segments = (row.target as { segments: { rects: number[][] }[] }).segments;
      return { quote: row.quote_text ?? "", rects: segments.flatMap((s) => s.rects) };
    };
    const removeLast = async () => {
      const box = await rects(page).last().boundingBox();
      if (!box) throw new Error("no highlight");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.press("Delete");
      await expect(rects(page)).toHaveCount(0);
      await settled(page);
    };
    // Exactly the selected words: no padding, no newline, and one rect of one line's height.
    let step = 0;
    const expectExactLine = (saved: Saved, line: string, n: number) => {
      expect(saved.quote).toBe(saved.quote.trim());
      expect(saved.quote).not.toContain("\n");
      expect(norm(line)).toContain(norm(saved.quote));
      expect(norm(saved.quote).length, `step ${n} quote "${saved.quote}"`).toBeGreaterThan(
        norm(line).length - 3,
      );
      expect(saved.rects, "one rect, one line").toHaveLength(1);
      const [r] = saved.rects as [number[]];
      expect((r[3] ?? 0) - (r[1] ?? 0)).toBeLessThan(20);
    };

    for (const line of fixture.lines) {
      // Drag to the end of the line and a little beyond, into the margin.
      await dragAcross(page, await textBox(page, fixture.page, line), 20);
      await expect(popover(page)).toHaveAttribute("data-mode", "create");
      await page.keyboard.press("1");
      expectExactLine(await lastSaved(), line, ++step);
      await removeLast();

      // Drag to the end of the line, releasing just below it (inside the line gap).
      const b2 = await textBox(page, fixture.page, line);
      await page.mouse.move(b2.left + 1, (b2.top + b2.bottom) / 2);
      await page.mouse.down();
      await page.mouse.move(b2.right + 15, b2.bottom + 1, { steps: 8 });
      await page.mouse.up();
      await expect(popover(page)).toHaveAttribute("data-mode", "create");
      await page.keyboard.press("1");
      expectExactLine(await lastSaved(), line, ++step);
      await removeLast();

      // Triple click: whatever block the browser selects, trimmed, one rect per quoted line.
      const b3 = await textBox(page, fixture.page, line);
      await page.mouse.click((b3.left + b3.right) / 2, (b3.top + b3.bottom) / 2, {
        clickCount: 3,
      });
      await expect(popover(page)).toHaveAttribute("data-mode", "create");
      await page.keyboard.press("1");
      const triple = await lastSaved();
      expect(triple.quote).toBe(triple.quote.trim());
      expect(norm(triple.quote)).toContain(norm(line).slice(0, 12));
      expect(triple.rects).toHaveLength(triple.quote.split("\n").length);
      await removeLast();
    }
  });
}

test("bug 3: highlights never overlap (recolor inside, merge when partly overlapping, undo)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const documentId = await openFixture(page, "ruler");

  // First highlight: words 3.. of L1.
  const first = "ruler paragraph begins";
  const firstAt = L1.indexOf(first);
  await highlightWithDrag(page, 0, L1, "1", { from: firstAt, to: firstAt + first.length });
  await expect(rects(page)).toHaveCount(1);
  await settled(page);
  const oldest = (await rows(documentId))[0]?.id;

  // (a) A selection inside it recolors instead of creating a second highlight.
  const at = L1.indexOf(first);
  const inner = await textBox(page, 0, L1, { from: at + 6, to: at + 15 });
  await dragAcross(page, inner);
  await expect(popover(page)).toHaveAttribute("data-mode", "edit");
  await page.keyboard.press("3");
  await expect(rects(page)).toHaveCount(1);
  await expect(page.locator('.mr-annot[data-color="example"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  // Same through a double click on a word.
  const word = await textBox(page, 0, L1, { from: at + 1, to: at + 4 });
  await page.mouse.dblclick((word.left + word.right) / 2, (word.top + word.bottom) / 2);
  await expect(popover(page)).toHaveAttribute("data-mode", "edit");
  await page.getByTestId("color-memorize").click();
  await expect(rects(page)).toHaveCount(1);
  await expect(page.locator('.mr-annot[data-color="memorize"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);

  // Add a comment on it, to see it survive the merge.
  const hb = await rects(page).first().boundingBox();
  if (!hb) throw new Error("no highlight");
  await page.mouse.click(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.keyboard.press("n");
  await page.keyboard.type("first comment");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // (b) A selection that overlaps its tail and runs on: merged, new color, one highlight.
  const tailAt = L1.indexOf("begins");
  const overlap = await textBox(page, 0, L1, { from: tailAt, to: L1.length });
  await dragAcross(page, overlap);
  await expect(popover(page)).toHaveAttribute("data-mode", "create");
  await page.keyboard.press("2");
  await expect(rects(page)).toHaveCount(1);
  await expect(page.locator('.mr-annot[data-color="definition"]')).toHaveCount(1);
  await settled(page);
  let now = await rows(documentId);
  expect(now).toHaveLength(1);
  expect(now[0]?.id).toBe(oldest);
  expect(now[0]?.quote_text).toBe(L1.slice(L1.indexOf("ruler")));
  expect(now[0]?.comment).toBe("first comment");

  // A selection spanning two highlights plus text between them merges all three.
  await highlightWithDrag(page, 0, L2, "4");
  await expect(rects(page)).toHaveCount(2);
  const a = await textBox(page, 0, L1, { from: L1.length - 12, to: L1.length });
  const b = await textBox(page, 0, L2, { from: 0, to: 10 });
  await page.mouse.move(a.left + 1, (a.top + a.bottom) / 2);
  await page.mouse.down();
  await page.mouse.move(b.right - 1, (b.top + b.bottom) / 2, { steps: 10 });
  await page.mouse.up();
  await expect(popover(page)).toHaveAttribute("data-mode", "create");
  await page.keyboard.press("5");
  await settled(page);
  now = await rows(documentId);
  expect(now).toHaveLength(1);
  expect(now[0]?.color).toBe("confusing");
  expect(now[0]?.comment).toBe("first comment");
  expect(now[0]?.quote_text).toContain("ruler paragraph");
  expect(now[0]?.quote_text).toContain("Every line");
  const keep = now.length;

  // One undo restores both previous highlights.
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("annotation-popover")).toHaveCount(0);
  await settled(page);
  expect(await rows(documentId)).toHaveLength(2);
  expect(keep).toBe(1);
  // Redo merges again.
  await page.keyboard.press("Control+Shift+z");
  await settled(page);
  expect(await rows(documentId)).toHaveLength(1);

  // Rects of one page never overlap each other.
  const overlaps = await page.evaluate(() => {
    const list = [...document.querySelectorAll(".mr-annot")].map((n) => n.getBoundingClientRect());
    let n = 0;
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const p = list[i];
        const q = list[j];
        if (
          p &&
          q &&
          p.left < q.right - 0.5 &&
          q.left < p.right - 0.5 &&
          p.top < q.bottom - 0.5 &&
          q.top < p.bottom - 0.5
        )
          n++;
      }
    return n;
  });
  expect(overlaps).toBe(0);
});
