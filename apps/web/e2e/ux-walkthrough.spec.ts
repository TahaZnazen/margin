import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// UX pass: a scripted real-user walkthrough (real pointer and keyboard) at desktop and phone size.
// Every step leaves a screenshot in evidence/ux-pass/<size>/ (git-ignored) to look at by eye; the
// assertions only check that each step worked.

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

const sizes = [
  { name: "desktop", width: 1440, height: 900, touch: false },
  { name: "mobile", width: 390, height: 844, touch: true },
] as const;

for (const size of sizes) {
  test.describe(`walkthrough ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch });
    test.describe.configure({ mode: "serial" });

    const email = `e2e-ux-${size.name}-${randomUUID()}@example.com`;
    const password = `pw-${randomUUID()}`;
    const dir = `../../evidence/ux-pass/${size.name}`;
    let userId = "";
    let step = 0;
    const shot = (page: Page, name: string) =>
      page.screenshot({ path: `${dir}/${String(++step).padStart(2, "0")}-${name}.png` });

    test.beforeAll(async () => {
      mkdirSync(dir, { recursive: true });
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

    test("sign in, library, upload, read, annotate, notes, export, settings, sign out", async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const mobile = size.name === "mobile";

      await page.goto("/sign-in");
      await shot(page, "sign-in");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/app$/);
      await expect(page.getByTestId("empty-state")).toBeVisible();
      await shot(page, "library-empty");

      // Upload two books; each opens at once, then the library fills up.
      await page.getByTestId("upload-input").setInputFiles(pdf("two-column-paper"));
      await expect(page).toHaveURL(/\/app\/read\/[0-9a-f-]{36}$/);
      await expect(page.locator(".mr-canvas").first()).toBeVisible();
      await shot(page, "reader-first-open");
      const paperUrl = page.url();
      await page.getByRole("link", { name: "Back to library" }).click();
      await expect(page.getByTestId("upload-item").first()).toHaveAttribute("data-stage", "done", {
        timeout: 40_000,
      });
      await page.getByTestId("upload-input").setInputFiles(pdf("french-accents-ligatures"));
      await expect(page).toHaveURL(/\/app\/read\/[0-9a-f-]{36}$/);
      await page.getByRole("link", { name: "Back to library" }).click();
      await expect(page.getByTestId("upload-item").last()).toHaveAttribute("data-stage", "done", {
        timeout: 40_000,
      });
      await expect(page.getByTestId("book")).toHaveCount(2);
      await shot(page, "library-grid");
      await page.getByRole("button", { name: "List view" }).click();
      await shot(page, "library-list");
      await page.getByRole("button", { name: "Grid view" }).click();

      // Open the book and walk the sidebar.
      await page.goto(paperUrl);
      await expect(page.locator(".mr-canvas").first()).toBeVisible();
      await page.getByTestId("sidebar-toggle").click();
      await shot(page, "sidebar-chapters");
      await page.getByRole("tab", { name: "Pages" }).click();
      await expect(page.locator('.mr-thumb-page[data-rendered="true"]').first()).toBeVisible();
      await shot(page, "sidebar-pages");
      await page.getByRole("tab", { name: "Bookmarks" }).click();
      await shot(page, "sidebar-bookmarks-empty");
      await page.getByRole("tab", { name: "Chapters" }).click();
      await page
        .getByRole("button", { name: "III Simple two-particle example", exact: true })
        .click();
      await expect(page.locator(".mr-canvas").first()).toBeVisible();
      if (!mobile) await page.getByTestId("sidebar-toggle").click();
      await shot(page, "chapter-opened");

      // Highlight with a real drag over a line of text, comment, delete, undo.
      const span = page
        .locator(".mr-page .mr-textlayer > span")
        .filter({ hasText: /\w{6,}.*\w{6,}.*\w{6,}/ })
        .first();
      await span.scrollIntoViewIfNeeded();
      const box = await span.boundingBox();
      if (!box) throw new Error("no text span");
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + 2, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 2, y, { steps: 8 });
      await page.mouse.up();
      await expect(page.getByTestId("annotation-popover")).toBeVisible();
      await shot(page, "selection-popover");
      await page.getByTestId("color-key").click();
      await expect(page.getByTestId("highlight-rect").first()).toBeVisible();
      await page.mouse.click(box.x + box.width / 2, y);
      await expect(page.getByTestId("annotation-popover")).toBeVisible();
      await page.getByTestId("comment-input").fill("Why does this hold?");
      await shot(page, "comment");
      await page.keyboard.press("Escape");
      await page.mouse.click(box.x + box.width / 2, y);
      await expect(page.getByTestId("annotation-popover")).toBeVisible();
      await page.getByTestId("popover-delete").click();
      await expect(page.getByTestId("highlight-rect")).toHaveCount(0);
      await shot(page, "deleted");
      await page.keyboard.press("Control+z");
      await expect(page.getByTestId("highlight-rect").first()).toBeVisible();
      await shot(page, "undo");

      // Side panel and notebook.
      await page.getByTestId("panel-toggle").click();
      await expect(page.getByTestId("annot-item")).toHaveCount(1);
      await shot(page, "panel-annotations");
      await page.getByTestId("add-to-notebook").first().click();
      await page.getByTestId("tab-notebook").click();
      await shot(page, "panel-notebook");
      if (mobile) await page.keyboard.press("Escape");
      else await page.getByTestId("panel-toggle").click();

      // Export from the reader.
      await page.getByTestId("export-menu").click();
      await shot(page, "export-menu");
      const [markdown] = await Promise.all([
        page.waitForEvent("download"),
        page.getByTestId("export-markdown").click(),
      ]);
      expect(markdown.suggestedFilename()).toMatch(/\.md$/);
      await page.getByTestId("export-menu").click();
      const [annotated] = await Promise.all([
        page.waitForEvent("download"),
        page.getByTestId("export-pdf").click(),
      ]);
      expect(annotated.suggestedFilename()).toMatch(/\.pdf$/);
      await shot(page, "exported");

      // Notes page, then settings, then out.
      await page.getByRole("link", { name: "Back to library" }).click();
      await page.goto("/app/notes");
      await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
      await expect(page.getByTestId("note-row").first()).toBeVisible({ timeout: 15_000 });
      await shot(page, "notes");
      await page.goto("/app/settings");
      await expect(page.getByRole("button", { name: "Save labels" })).toBeEnabled({
        timeout: 15_000,
      });
      await shot(page, "settings");
      await page.getByRole("button", { name: "Export everything" }).click();
      await shot(page, "settings-exporting");
      await page.getByRole("button", { name: "Account menu" }).first().click();
      await shot(page, "account-menu");
      await page.getByRole("menuitem", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/sign-in/);
      await shot(page, "signed-out");
    });

    test("themes and dark mode", async ({ page }) => {
      await page.goto("/sign-in");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/app$/);
      await page.getByTestId("book").first().getByRole("link").first().click();
      await expect(page.locator(".mr-canvas").first()).toBeVisible();
      if (size.name === "desktop") await page.getByTestId("sidebar-toggle").click();
      for (const theme of ["sepia", "dark"] as const) {
        if (size.name === "desktop") {
          await page.getByRole("radio", { name: theme === "sepia" ? "Sepia" : "Dark" }).click();
        } else {
          // The phone header has one button that steps system, light, sepia, dark.
          const cycle = page.getByRole("button", { name: /^Theme: / });
          while (!(await page.locator("html").evaluate((el, t) => el.classList.contains(t), theme)))
            await cycle.click();
        }
        await page.waitForTimeout(300);
        await shot(page, `theme-${theme}`);
      }
    });
  });
}
