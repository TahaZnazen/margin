import { expect, test } from "@playwright/test";

test("signed out, / leads to the sign-in page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("health page renders and Supabase health is OK", async ({ page }) => {
  await page.goto("/health");

  await expect(page).toHaveTitle("Margin");
  await expect(page.getByRole("heading", { level: 1, name: "Margin" })).toBeVisible();

  const health = page.getByTestId("supabase-health");
  await expect(health).toHaveAttribute("data-status", "ok");
  await expect(health).toContainText("Supabase: OK");
});
