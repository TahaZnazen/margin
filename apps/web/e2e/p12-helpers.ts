import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Shared by the P12 specs (PWA, offline, palette, a11y, keyboard walkthrough): a throwaway user
// against margin-dev, the fixture PDFs and a few reader helpers.

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), "../../fixtures/pdfs/manifest.json"), "utf8"),
) as { entries: { id: string; file: string }[] };

export const pdf = (id: string) => {
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

export const admin = createClient(
  readEnv("NEXT_PUBLIC_SUPABASE_URL"),
  readEnv("SUPABASE_SECRET_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

export async function createUser(prefix: string): Promise<TestUser> {
  const email = `e2e-${prefix}-${randomUUID()}@example.com`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  return { id: data.user.id, email, password };
}

export async function deleteUser(user: TestUser | undefined) {
  if (!user?.id) return;
  const bucket = admin.storage.from("documents");
  const { data: folders } = await bucket.list(user.id);
  const paths: string[] = [];
  for (const folder of folders ?? []) {
    const { data: files } = await bucket.list(`${user.id}/${folder.name}`);
    for (const file of files ?? []) paths.push(`${user.id}/${folder.name}/${file.name}`);
  }
  if (paths.length) await bucket.remove(paths);
  await admin.auth.admin.deleteUser(user.id);
}

export async function signIn(page: Page, user: TestUser) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

/** Uploads a fixture through the file input and waits until it is saved and the library shows it. */
export async function uploadAndSettle(page: Page, fixture: string): Promise<string> {
  await page.getByTestId("upload-input").setInputFiles(pdf(fixture));
  await expect(page).toHaveURL(/\/app\/read\/[0-9a-f-]{36}$/);
  const url = page.url();
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page.getByTestId("upload-item").first()).toHaveAttribute("data-stage", "done", {
    timeout: 40_000,
  });
  return url;
}

/** Selects the text of one span of a page, as a drag would. */
export async function selectText(page: Page, pageIndex: number, text: string) {
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

export const RULER_LINE = "Line one of the ruler paragraph begins exactly at x = 72 pt.";

/** The service worker is active and the offline warm-up finished (see lib/pwa/pwa.tsx). */
export async function waitOfflineReady(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-offline-ready", "true", {
    timeout: 60_000,
  });
}
