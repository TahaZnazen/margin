import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { strFromU8, unzipSync } from "fflate";

// P11: import on upload, Markdown / annotated PDF / zip export, against the dev Supabase project.

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

const email = `e2e-io-${randomUUID()}@example.com`;
const password = `pw-${randomUUID()}`;
let userId = "";
const EVIDENCE = "../../evidence/p10-p11";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
}

const rows = async (table: "annotations" | "notes" | "documents") => {
  const { data } = await admin
    .from(table)
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at");
  return data ?? [];
};

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

test("import on upload, Markdown and annotated PDF export, round trip through the UI, zip", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page);

  // Import: the fixture has two highlights (yellow, green) and one sticky note.
  await page.getByTestId("upload-input").setInputFiles(pdf("annotations"));
  await expect(page).toHaveURL(/\/app\/read\/[0-9a-f-]{36}$/);
  const bookUrl = page.url();
  await expect(page.getByText("Imported 2 highlights and 1 note")).toBeVisible();
  await expect(page.getByTestId("highlight-rect")).toHaveCount(3);
  await expect(page.getByTestId("pending-writes")).toHaveText("0", { timeout: 15_000 });

  let items = await rows("annotations");
  expect(items.map((r) => `${r.kind}:${r.color}`).sort()).toEqual([
    "bookmark:null",
    "highlight:definition",
    "highlight:key",
  ]);
  expect(items.find((r) => r.color === "key")?.comment).toBe(
    "Imported highlight: yellow, one line",
  );
  expect(items.find((r) => r.color === "key")?.quote_text).toBe(
    "This sentence carries a yellow imported highlight.",
  );
  expect(items.find((r) => r.kind === "bookmark")?.comment).toBe("Imported sticky note");
  expect((await rows("documents"))[0]?.annotations_imported_at).not.toBeNull();

  // A reload would cancel an upload still in flight: wait until the book is readable server-side.
  await expect
    .poll(async () => (await rows("documents")).map((d) => d.read_status).join(), {
      timeout: 90_000,
    })
    .toBe("readable");

  // Runs once: a reload does not import again.
  await page.reload();
  await expect(page.getByTestId("highlight-rect")).toHaveCount(3);
  await page.waitForTimeout(1500);
  expect(await rows("annotations")).toHaveLength(3);

  // Put one highlight in the notebook so the Markdown has a linked quote.
  await page.getByTestId("panel-toggle").click();
  await page
    .getByTestId("annot-item")
    .filter({ hasText: "yellow imported" })
    .getByTestId("add-to-notebook")
    .click();
  await expect(page.getByTestId("notebook-pending")).toHaveText("0", { timeout: 15_000 });
  await expect.poll(async () => (await rows("notes")).length).toBe(1);

  // Markdown export.
  await page.getByTestId("export-menu").click();
  const mdDownload = page.waitForEvent("download");
  await page.getByTestId("export-markdown").click();
  const md = await mdDownload;
  const mdPath = join(EVIDENCE, "export.md");
  await md.saveAs(mdPath);
  const text = readFileSync(mdPath, "utf8");
  expect(text).toMatch(/^---\ntitle: ".+"\n(author: ".+"\n)?exported_at: "/);
  expect(text).toContain("## Highlights");
  expect(text).toContain("This sentence carries a yellow imported highlight.");
  expect(text).toContain("**Key idea** · p. 1");
  expect(text).toContain("Imported highlight: yellow, one line");
  expect(text).toContain("## Notebook");
  expect(text).not.toMatch(/(^|[^\\])<[a-z/]/i);
  const keyId = String(items.find((r) => r.color === "key")?.id);
  const link = new RegExp(`\\]\\((http[^)]+/app/read/[0-9a-f-]{36}#a=${keyId})\\)`).exec(text);
  expect(link, "deep link in the Markdown").not.toBeNull();

  // The deep link opens the exact highlight.
  await page.goto(link?.[1] ?? "");
  await expect(
    page.locator(`.mr-annot[data-annotation-id="${keyId}"][data-flash="true"]`).first(),
  ).toBeAttached();

  // Annotated PDF export, then import it as a new document: same highlights come back.
  await page.getByTestId("export-menu").click();
  const pdfDownload = page.waitForEvent("download");
  await page.getByTestId("export-pdf").click();
  const exportedPdf = join(EVIDENCE, "annotated.pdf");
  await (await pdfDownload).saveAs(exportedPdf);
  copyFileSync(exportedPdf, join(EVIDENCE, "annotated-copy.pdf"));

  await page.goto("/app");
  await page.waitForLoadState("networkidle"); // hydrated: the input handler is attached
  await page.getByTestId("upload-input").setInputFiles(exportedPdf);
  await expect(page).toHaveURL(/\/app\/read\/[0-9a-f-]{36}$/);
  expect(page.url()).not.toBe(bookUrl);
  await expect(page.getByText("Imported 2 highlights and 1 note")).toBeVisible();
  await expect(page.getByTestId("highlight-rect")).toHaveCount(3);
  await expect(page.getByTestId("pending-writes")).toHaveText("0", { timeout: 15_000 });
  items = await rows("annotations");
  expect(items).toHaveLength(6);
  expect(
    items.filter((r) => r.quote_text === "This sentence carries a yellow imported highlight."),
  ).toHaveLength(2);

  // Both uploads are readable server-side before the export looks for their files.
  await expect
    .poll(async () => (await rows("documents")).map((d) => d.read_status).join(), {
      timeout: 90_000,
    })
    .toBe("readable,readable");

  // Settings -> Data: the zip has every table and every book's Markdown.
  await page.goto("/app/settings");
  const zipDownload = page.waitForEvent("download");
  await page.getByTestId("export-everything").click();
  const zipPath = join(EVIDENCE, "export-everything.zip");
  await (await zipDownload).saveAs(zipPath);
  const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
  const dump = JSON.parse(strFromU8(files["margin-data.json"] as Uint8Array)) as {
    version: number;
    tables: Record<string, unknown[]>;
  };
  expect(dump.version).toBe(1);
  expect(Object.keys(dump.tables).sort()).toEqual([
    "annotations",
    "collection_documents",
    "collections",
    "documents",
    "notes",
    "reading_state",
    "user_settings",
  ]);
  expect(dump.tables.documents).toHaveLength(2);
  expect(dump.tables.annotations).toHaveLength(6);
  expect(dump.tables.notes).toHaveLength(1);
  expect(
    Object.keys(files).filter((f) => f.startsWith("books/") && f.endsWith(".md")),
  ).toHaveLength(2);
  expect(Object.keys(files).some((f) => f.endsWith(".pdf"))).toBe(false);

  // With the checkbox the PDFs are in the zip too.
  await page.getByTestId("export-include-pdfs").check();
  const withPdfs = page.waitForEvent("download");
  await page.getByTestId("export-everything").click();
  const zip2 = join(EVIDENCE, "export-everything-with-pdfs.zip");
  await (await withPdfs).saveAs(zip2);
  const files2 = unzipSync(new Uint8Array(readFileSync(zip2)));
  expect(
    Object.keys(files2).filter((f) => f.startsWith("pdfs/") && f.endsWith(".pdf")),
  ).toHaveLength(2);
});
