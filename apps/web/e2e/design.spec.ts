import { expect, test } from "@playwright/test";

test("/dev/ui renders all three themes", async ({ page }) => {
  await page.goto("/dev/ui");
  for (const theme of ["light", "sepia", "dark"]) {
    await expect(page.getByTestId(`panel-${theme}`)).toBeVisible();
  }
});

test("theme class is on <html> before hydration (no flash)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("margin:theme", "dark"));
  await page.goto("/dev/ui", { waitUntil: "commit" });
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(23, 22, 20)");
});

test("sepia theme does not apply Tailwind's sepia filter", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("margin:theme", "sepia"));
  await page.goto("/dev/ui");
  const filter = await page.evaluate(() => getComputedStyle(document.documentElement).filter);
  expect(filter).toBe("none");
});
