import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/** Env from the process (CI) or apps/web/.env.local (local); values are never printed. */
function readEnv(name: string): string {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    const match = text.match(new RegExp(`^${name}=(.*)$`, "m"));
    if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    // fall through
  }
  throw new Error(`${name} is not set`);
}

const admin = createClient(readEnv("NEXT_PUBLIC_SUPABASE_URL"), readEnv("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const email = `e2e-${randomUUID()}@example.com`;
const password = `pw-${randomUUID()}`;
let userId = "";

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
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test("signed-out /app redirects to /sign-in", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.screenshot({ path: "../../evidence/p05/sign-in.png" });
});

test("sign-up form is hidden when ALLOW_SIGNUPS is not true", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Email me a magic link" })).toBeVisible();
  await expect(page.getByText("Create an account")).toHaveCount(0);
});

test("sign in, shell, theme persists across reload, sign out", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main", exact: true })).toBeVisible();
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await page.screenshot({ path: "../../evidence/p05/app.png" });

  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByTestId("account-email")).toHaveText(email);
  await page.keyboard.press("Escape");

  // Signed-in visit to /sign-in goes to /app.
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/settings");
  const html = page.locator("html");
  const saved = page.waitForResponse(
    (r) => r.url().includes("/rest/v1/user_settings") && r.request().method() === "POST",
  );
  await page.getByRole("radio", { name: "Sepia" }).click();
  await expect(html).toHaveClass(/sepia/);
  expect((await saved).ok()).toBe(true);

  await page.reload();
  await expect(html).toHaveClass(/sepia/);
  await expect(page.getByRole("radio", { name: "Sepia" })).toHaveAttribute("aria-checked", "true");

  // Server copy wins on a fresh browser profile (no localStorage).
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(html).toHaveClass(/sepia/);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in$/);
});
