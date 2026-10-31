import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// P06: local-first data layer. Local write speed, two-device sync, offline, chaos, error policy,
// sign-out. Writes go through the same repos the UI uses (window.__margin), against margin-dev.

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

const password = `pw-${randomUUID()}`;
const userA = { email: `e2e-sync-a-${randomUUID()}@example.com`, id: "" };
const userB = { email: `e2e-sync-b-${randomUUID()}@example.com`, id: "" };
const SYNC_BUDGET_MS = process.env.CI ? 6000 : 2000;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  for (const user of [userA, userB]) {
    const { data, error } = await admin.auth.admin.createUser({
      email: user.email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    user.id = data.user.id;
  }
});

test.afterAll(async () => {
  for (const user of [userA, userB]) if (user.id) await admin.auth.admin.deleteUser(user.id);
});

async function seedDocument(): Promise<string> {
  const id = randomUUID();
  const { error } = await admin.from("documents").insert({
    id,
    user_id: userA.id,
    title: "Sync fixture",
    sha256: randomUUID().replaceAll("-", "").repeat(2),
    read_status: "readable",
  });
  if (error) throw new Error(error.message);
  return id;
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-state", "synced", {
    timeout: 20_000,
  });
}

async function signedInContext(browser: Browser, email: string): Promise<[BrowserContext, Page]> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return [context, page];
}

/** Saves `count` highlight annotations on a document through the app's own repo. */
async function saveAnnotations(page: Page, documentId: string, ids: string[]) {
  await page.evaluate(
    async ([docId, list]) => {
      const { services } = (
        window as unknown as {
          __margin: { services: () => import("../src/lib/documents/services").Services };
        }
      ).__margin;
      const now = new Date().toISOString();
      for (const [i, id] of (list as string[]).entries()) {
        await services().annotations.save({
          id,
          documentId: docId as string,
          kind: "highlight",
          color: "key",
          target: {
            fingerprint: `sha256:${"a".repeat(64)}`,
            segments: [{ page: 0, rects: [[72, 100 + i, 200, 112 + i]] }],
            quote: { exact: `quote ${i}`, prefix: "", suffix: "" },
          },
          pageStart: 0,
          quoteText: `quote ${i}`,
          comment: null,
          tags: [],
          anchorStatus: "anchored",
          createdAt: now,
          updatedAt: now,
        });
      }
    },
    [documentId, ids] as const,
  );
}

const localIds = (page: Page, documentId: string) =>
  page.evaluate(async (docId) => {
    const { services } = (
      window as unknown as {
        __margin: { services: () => import("../src/lib/documents/services").Services };
      }
    ).__margin;
    return (await services().annotations.list(docId)).map((a) => a.id);
  }, documentId);

async function postgresIds(documentId: string): Promise<string[]> {
  const { data } = await admin
    .from("annotations")
    .select("id")
    .eq("document_id", documentId)
    .is("deleted_at", null);
  return (data ?? []).map((r) => r.id as string);
}

test("a local write is visible in the same tab in under 50 ms", async ({ browser }) => {
  const documentId = await seedDocument();
  const [context, page] = await signedInContext(browser, userA.email);
  await expect.poll(() => page.evaluate(() => typeof window !== "undefined"), {}).toBe(true);
  await saveAnnotations(page, documentId, [randomUUID()]); // warm-up (JIT, first statement)
  const ms = await page.evaluate(async (docId) => {
    const { services } = (
      window as unknown as {
        __margin: { services: () => import("../src/lib/documents/services").Services };
      }
    ).__margin;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    performance.mark("write-start");
    await services().annotations.save({
      id,
      documentId: docId,
      kind: "bookmark",
      color: null,
      target: { fingerprint: `sha256:${"a".repeat(64)}`, segments: [{ page: 1, rects: [] }] },
      pageStart: 1,
      quoteText: null,
      comment: null,
      tags: [],
      anchorStatus: "anchored",
      createdAt: now,
      updatedAt: now,
    });
    const seen = (await services().annotations.list(docId)).some((a) => a.id === id);
    performance.mark("write-seen");
    if (!seen) throw new Error("write not visible");
    return performance.measure("write", "write-start", "write-seen").duration;
  }, documentId);
  console.log(`[sync] local write visible after ${ms.toFixed(1)} ms`);
  expect(ms).toBeLessThan(50);
  await context.close();
});

test("a change in one browser shows in another within the sync budget", async ({ browser }) => {
  const documentId = await seedDocument();
  const [ctxA, pageA] = await signedInContext(browser, userA.email);
  const [ctxB, pageB] = await signedInContext(browser, userA.email);
  const id = randomUUID();
  const started = Date.now();
  await saveAnnotations(pageA, documentId, [id]);
  await expect
    .poll(async () => (await localIds(pageB, documentId)).includes(id), {
      timeout: 15_000,
      intervals: [50],
    })
    .toBe(true);
  const elapsed = Date.now() - started;
  console.log(`[sync] A to B in ${elapsed} ms`);
  expect(elapsed).toBeLessThan(SYNC_BUDGET_MS);
  await ctxA.close();
  await ctxB.close();
});

test("offline: 50 writes are kept locally, then all reach Postgres and the other browser", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const documentId = await seedDocument();
  const [ctxA, pageA] = await signedInContext(browser, userA.email);
  const [ctxB, pageB] = await signedInContext(browser, userA.email);
  const ids = Array.from({ length: 50 }, () => randomUUID());

  await ctxA.setOffline(true);
  await expect(pageA.getByTestId("sync-status")).toHaveAttribute("data-state", "offline");
  await saveAnnotations(pageA, documentId, ids);
  // The same row saved twice in a row (an edit) must not trip the batched upload.
  await saveAnnotations(pageA, documentId, [ids[0] as string]);
  // Still there from local storage while offline. (A full page reload while offline needs the
  // service worker that caches the app shell: P12 completes that part.)
  expect((await localIds(pageA, documentId)).sort()).toEqual([...ids].sort());
  expect(await postgresIds(documentId)).toEqual([]);

  await ctxA.setOffline(false);
  const online = Date.now();
  await expect
    .poll(async () => (await postgresIds(documentId)).length, { timeout: 60_000, intervals: [250] })
    .toBe(50);
  console.log(`[sync] 50 offline rows in Postgres ${Date.now() - online} ms after reconnect`);
  await expect
    .poll(async () => (await localIds(pageB, documentId)).length, {
      timeout: 30_000,
      intervals: [250],
    })
    .toBe(50);
  await ctxA.close();
  await ctxB.close();
});

test("chaos: closing the tab right after a write loses nothing", async ({ browser }) => {
  test.setTimeout(90_000);
  const documentId = await seedDocument();
  const [ctx, page] = await signedInContext(browser, userA.email);
  const id = randomUUID();
  await ctx.setOffline(true); // the write can't upload before the tab dies
  await saveAnnotations(page, documentId, [id]);
  await page.close();
  expect(await postgresIds(documentId)).toEqual([]);
  await ctx.setOffline(false);
  const reopened = await ctx.newPage();
  await reopened.goto("/app");
  await expect(reopened.getByTestId("sync-status")).toBeVisible();
  await expect
    .poll(async () => postgresIds(documentId), { timeout: 30_000, intervals: [250] })
    .toEqual([id]);
  await ctx.close();
});

test("a row the database rejects lands in sync_errors and does not block later writes", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const documentId = await seedDocument();
  const [ctx, page] = await signedInContext(browser, userA.email);
  const bad = randomUUID();
  const good = randomUUID();
  await page.evaluate(
    async ([docId, badId]) => {
      const { db } = (
        window as unknown as { __margin: { db: () => import("@powersync/web").PowerSyncDatabase } }
      ).__margin;
      const now = new Date().toISOString();
      // A highlight with no quote text violates annotations_highlight_check in Postgres.
      await db().execute(
        `INSERT INTO annotations (id, user_id, document_id, kind, color, target, page_start, quote_text, tags, anchor_status, created_at, updated_at)
         VALUES (?, (SELECT user_id FROM documents WHERE id = ?), ?, 'highlight', 'key', ?, 0, NULL, '[]', 'anchored', ?, ?)`,
        [
          badId,
          docId,
          docId,
          JSON.stringify({
            fingerprint: `sha256:${"a".repeat(64)}`,
            segments: [{ page: 0, rects: [[1, 1, 2, 2]] }],
            quote: { exact: "x", prefix: "", suffix: "" },
          }),
          now,
          now,
        ],
      );
    },
    [documentId, bad] as const,
  );
  await saveAnnotations(page, documentId, [good]);
  await expect
    .poll(async () => postgresIds(documentId), { timeout: 30_000, intervals: [250] })
    .toEqual([good]);
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-state", "error");
  await page.getByTestId("sync-status").click();
  await expect(page.getByTestId("sync-errors")).toContainText("annotations");
  await ctx.close();
});

test("sign-out clears local data, and another user never sees it", async ({ browser }) => {
  test.setTimeout(90_000);
  const documentId = await seedDocument();
  const [ctx, page] = await signedInContext(browser, userA.email);
  await saveAnnotations(page, documentId, [randomUUID()]);
  await expect.poll(async () => (await postgresIds(documentId)).length).toBe(1);
  expect((await localIds(page, documentId)).length).toBe(1);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await signIn(page, userB.email);
  const counts = await page.evaluate(async () => {
    const { db } = (
      window as unknown as { __margin: { db: () => import("@powersync/web").PowerSyncDatabase } }
    ).__margin;
    const out: Record<string, number> = {};
    for (const table of ["documents", "annotations", "notes", "reading_state"]) {
      const row = await db().get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`);
      out[table] = row.n;
    }
    return out;
  });
  expect(counts).toEqual({ documents: 0, annotations: 0, notes: 0, reading_state: 0 });
  await expect(page.getByTestId("library")).not.toContainText("Sync fixture");
  await ctx.close();
});
