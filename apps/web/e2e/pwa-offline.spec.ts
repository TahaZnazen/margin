import { expect, test } from "@playwright/test";
import {
  admin,
  createUser,
  deleteUser,
  RULER_LINE,
  selectText,
  signIn,
  type TestUser,
  uploadAndSettle,
  waitOfflineReady,
} from "./p12-helpers";

// P12: installable PWA and the offline acceptance test (completes the P06 offline-reload check).

test.describe.configure({ mode: "serial" });

let user: TestUser;
let bookUrl = "";

test.beforeAll(async () => {
  user = await createUser("pwa");
});
// Automated browsers skip the service worker by default (see lib/pwa/pwa.tsx); this spec tests it.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("margin.e2e.pwa", "1"));
});
test.afterAll(async () => {
  await deleteUser(user);
});

test("manifest, icons and service worker registration", async ({ page, request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as {
    name: string;
    start_url: string;
    display: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(manifest.name).toBe("Margin");
  expect(manifest.start_url).toBe("/app");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.some((i) => i.sizes === "192x192")).toBe(true);
  expect(manifest.icons.some((i) => i.sizes === "512x512")).toBe(true);
  expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
  for (const icon of manifest.icons) {
    expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
  }
  expect(
    ((await request.get("/sw.js")).headers()["content-type"] ?? "").includes("javascript"),
  ).toBe(true);

  await signIn(page, user);
  await waitOfflineReady(page);
  const active = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.active?.scriptURL ?? null;
  });
  expect(active).toMatch(/\/sw\.js$/);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest/);
});

test("the service worker never caches API, Supabase or storage responses", async ({ page }) => {
  await signIn(page, user);
  await waitOfflineReady(page);
  await page.goto("/app/settings");
  await expect(page.getByTestId("storage-section")).toBeVisible();
  const urls = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) out.push(req.url);
    }
    return out;
  });
  expect(urls.length).toBeGreaterThan(5);
  const origin = new URL(page.url()).origin;
  for (const url of urls) {
    expect(url.startsWith(origin), url).toBe(true);
    expect(url).not.toMatch(/\/api\/|supabase|powersync\.com|\/storage\//);
  }
});

test("offline: library, a cached book, a highlight and a note, then they sync", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await signIn(page, user);
  bookUrl = await uploadAndSettle(page, "ruler");
  await expect(page.getByTestId("book")).toHaveCount(1);
  await expect(page.getByTestId("sync-status").first()).toHaveAttribute("data-state", "synced", {
    timeout: 30_000,
  });

  // One online visit to the book (a real navigation), then everything is cached.
  await page.goto(bookUrl);
  await expect(page.locator(".mr-canvas").first()).toBeVisible();
  await waitOfflineReady(page);
  await page.goto("/app");
  await expect(page.getByTestId("book")).toHaveCount(1);
  await expect(page.getByTestId("offline-badge")).toBeVisible();

  await context.setOffline(true);
  try {
    // The library opens from the cached app shell and the local database.
    await page.reload();
    await expect(page.getByTestId("book")).toHaveCount(1, { timeout: 20_000 });
    await expect(page.getByTestId("sync-status").first()).toHaveAttribute("data-state", "offline", {
      timeout: 20_000,
    });

    // The book opens from the cached page and the PDF cached on this device.
    await page.goto(bookUrl);
    await expect(page.locator(".mr-canvas").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".mr-textlayer > span").first()).toBeAttached();

    // Highlight and note, offline.
    await selectText(page, 0, RULER_LINE);
    await page.keyboard.press("2");
    await expect(page.getByTestId("highlight-rect")).toHaveCount(1);
    await selectText(page, 0, "Every line in this block uses 11 pt Helvetica with 15 pt leading.");
    await page.keyboard.press("n");
    await expect(page.getByTestId("comment-input")).toBeFocused();
    await page.keyboard.type("written offline");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("comment-marker")).toBeVisible();
    await expect(page.getByTestId("sync-status").first()).toHaveAttribute("data-state", "offline");
  } finally {
    await context.setOffline(false);
  }

  // Back online: both land in Postgres.
  await expect
    .poll(
      async () => {
        const { data } = await admin
          .from("annotations")
          .select("kind, color, comment, deleted_at")
          .eq("user_id", user.id)
          .is("deleted_at", null);
        return {
          highlights: (data ?? []).filter((r) => r.kind === "highlight").length,
          offlineNote: (data ?? []).some((r) => r.comment === "written offline"),
        };
      },
      { timeout: 60_000, intervals: [500] },
    )
    .toEqual({ highlights: 2, offlineNote: true });
});

test("Keep offline: toggle in the book menu, listed in Settings > Storage, removable", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // A fresh browser context: the book is in the library (synced) but not stored on this device.
  await signIn(page, user);
  await expect(page.getByTestId("book")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId("offline-badge")).toHaveCount(0);
  await page.goto("/app/settings");
  await expect(page.getByText(/No books are stored on this device yet/)).toBeVisible();

  await page.goto("/app");
  await page.getByRole("button", { name: /^Menu for / }).click();
  await page.getByRole("menuitemcheckbox", { name: "Keep offline" }).click();
  await expect(page.getByTestId("offline-badge")).toBeVisible({ timeout: 30_000 });

  await page.goto("/app/settings");
  const rows = page.getByTestId("storage-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(/ruler/i);
  await expect(rows.first()).toContainText(/KB|MB/);
  await expect(page.getByTestId("storage-total")).toContainText(/Books on this device: .*(KB|MB)/);
  await expect(page.getByTestId("storage-total")).toContainText(/Browser storage used/);
  await rows.first().getByRole("button", { name: "Remove from this device" }).click();
  await expect(page.getByText(/No books are stored on this device yet/)).toBeVisible();

  // Checking and unchecking in the menu.
  await page.goto("/app");
  await page.getByRole("button", { name: /^Menu for / }).click();
  await page.getByRole("menuitemcheckbox", { name: "Keep offline" }).click();
  await expect(page.getByTestId("offline-badge")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Menu for / }).click();
  await page.getByRole("menuitemcheckbox", { name: "Keep offline" }).click();
  await expect(page.getByTestId("offline-badge")).toHaveCount(0);
});
