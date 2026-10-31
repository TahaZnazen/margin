import { randomUUID } from "node:crypto";
import { AnnotationShape } from "@margin/annotation-model";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DOCUMENTS_BUCKET, TABLE_NAMES, type TableName } from "./index";

/**
 * Two-user security test against the dev project (margin-dev): user B must not see, change or
 * create anything of user A's, in any table or in storage. ARCHITECTURE §8.
 */

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing (see test/setup.integration.ts)`);
  return value;
}

const SUPABASE_URL = env("NEXT_PUBLIC_SUPABASE_URL");
const noSession = { auth: { persistSession: false, autoRefreshToken: false } } as const;
const admin = createClient(SUPABASE_URL, env("SUPABASE_SECRET_KEY"), noSession);
const anon = createClient(SUPABASE_URL, env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), noSession);

interface TestUser {
  id: string;
  client: SupabaseClient;
}

const createdUserIds: string[] = [];

async function createUser(label: string): Promise<TestUser> {
  const email = `p02-rls-${label}-${randomUUID()}@example.com`;
  const password = `${randomUUID()}-Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  const client = createClient(SUPABASE_URL, env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), noSession);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, client };
}

const fingerprint = `sha256:${"a".repeat(64)}`;
const highlightTarget = {
  fingerprint,
  segments: [{ page: 0, rects: [[72, 100, 300, 112]] }],
  quote: { exact: "the exact words", prefix: "", suffix: "" },
};

type Row = Record<string, unknown>;

/** One row per table for `userId`, in insert order, with fresh ids. */
function rowsFor(userId: string): Record<TableName, Row> {
  const documentId = randomUUID();
  const collectionId = randomUUID();
  return {
    documents: { id: documentId, user_id: userId, title: "Book", sha256: "a".repeat(64) },
    reading_state: { id: randomUUID(), user_id: userId, document_id: documentId, page: 3 },
    annotations: {
      id: randomUUID(),
      user_id: userId,
      document_id: documentId,
      kind: "highlight",
      color: "key",
      target: highlightTarget,
      page_start: 0,
      quote_text: "the exact words",
    },
    notes: { id: randomUUID(), user_id: userId, document_id: documentId, title: "Note" },
    collections: { id: collectionId, user_id: userId, name: "Shelf" },
    collection_documents: {
      id: randomUUID(),
      user_id: userId,
      collection_id: collectionId,
      document_id: documentId,
    },
    user_settings: { id: randomUUID(), user_id: userId, theme: "dark" },
    chapter_progress: {
      id: randomUUID(),
      user_id: userId,
      document_id: documentId,
      chapter_key: "o:1:introduction",
      title: "Introduction",
      page_start: 0,
      done_at: new Date().toISOString(),
    },
  };
}

let a: TestUser;
let b: TestUser;
let aRows: Record<TableName, Row>;
const aObject = () => `${a.id}/${aRows.documents.id}/source.pdf`;
const pdfBytes = new TextEncoder().encode("%PDF-1.7\n% two-user test\n%%EOF\n");

beforeAll(async () => {
  a = await createUser("a");
  b = await createUser("b");
  aRows = rowsFor(a.id);
  for (const table of TABLE_NAMES) {
    const { error } = await a.client.from(table).insert(aRows[table]);
    if (error) throw new Error(`A couldn't insert into ${table}: ${error.message}`);
  }
  const upload = await a.client.storage
    .from(DOCUMENTS_BUCKET)
    .upload(aObject(), pdfBytes, { contentType: "application/pdf" });
  if (upload.error) throw upload.error;
}, 60_000);

afterAll(async () => {
  // Storage objects don't cascade with the user, so remove them first.
  // The test only writes `{user}/{folder}/{file}`, so two levels of listing find everything.
  const storage = admin.storage.from(DOCUMENTS_BUCKET);
  for (const id of createdUserIds) {
    const { data: folders } = await storage.list(id, { limit: 100 });
    for (const folder of folders ?? []) {
      const path = `${id}/${folder.name}`;
      const { data: files } = await storage.list(path, { limit: 100 });
      const paths = (files ?? []).map((file) => `${path}/${file.name}`);
      if (paths.length > 0) await storage.remove(paths);
    }
  }
  // Deleting the users cascades to every row they own.
  for (const id of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;
  }
}, 60_000);

/** What the database holds for A's row in `table`, read with the secret key (bypasses RLS). */
async function adminRead(table: TableName): Promise<Row | null> {
  const { data, error } = await admin.from(table).select("*").eq("id", aRows[table].id);
  if (error) throw error;
  return data[0] ?? null;
}

describe.each(TABLE_NAMES)("table %s", (table) => {
  it("A reads its own row (control)", async () => {
    const { data, error } = await a.client.from(table).select("*");
    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([aRows[table].id]);
  });

  it("B reads 0 of A's rows", async () => {
    const all = await b.client.from(table).select("*");
    expect(all.error).toBeNull();
    expect(all.data).toEqual([]);
    const byId = await b.client.from(table).select("*").eq("id", aRows[table].id);
    expect(byId.data).toEqual([]);
  });

  it("the anonymous client reads 0 rows", async () => {
    const { data } = await anon.from(table).select("*");
    expect(data ?? []).toEqual([]);
  });

  it("B can't insert a row carrying A's user_id", async () => {
    // Postgres checks the RLS policy before unique keys and foreign keys, so a copy of A's row
    // fails on RLS (42501), not on a duplicate key.
    const forged = { ...aRows[table], id: randomUUID() };
    const { error } = await b.client.from(table).insert(forged);
    expect(error?.code).toBe("42501");
    const { data } = await admin.from(table).select("id").eq("id", forged.id);
    expect(data).toEqual([]);
  });

  it("B can't change or delete A's row", async () => {
    const before = await adminRead(table);
    const update = await b.client
      .from(table)
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", aRows[table].id)
      .select();
    expect(update.data ?? []).toEqual([]);
    const remove = await b.client.from(table).delete().eq("id", aRows[table].id).select();
    expect(remove.data ?? []).toEqual([]);
    expect(await adminRead(table)).toEqual(before);
  });
});

describe("cross-user references", () => {
  it.each([
    "reading_state",
    "annotations",
    "notes",
    "collection_documents",
    "chapter_progress",
  ] as const)("B can't attach its own %s row to A's document", async (table) => {
    const bRows = rowsFor(b.id);
    if (table === "collection_documents") {
      // B's own collection exists, so only the document reference can fail.
      const { error } = await b.client.from("collections").insert(bRows.collections);
      expect(error).toBeNull();
    }
    const forged = { ...bRows[table], document_id: aRows.documents.id };
    const { error } = await b.client.from(table).insert(forged);
    // The composite foreign key (user_id, document_id) → documents(user_id, id) finds no match.
    expect(error?.code).toBe("23503");
  });
});

describe("chapter_progress (ADR 0004)", () => {
  it("rejects a second row for the same chapter of the same document", async () => {
    const duplicate = { ...aRows.chapter_progress, id: randomUUID() };
    const { error } = await a.client.from("chapter_progress").insert(duplicate);
    expect(error?.code).toBe("23505");
  });

  it("rejects an unknown source", async () => {
    const bad = {
      ...aRows.chapter_progress,
      id: randomUUID(),
      chapter_key: "o:2:x",
      source: "bot",
    };
    const { error } = await a.client.from("chapter_progress").insert(bad);
    expect(error?.code).toBe("23514");
  });

  it("un-marking (done_at = null) is an update, and updated_at moves", async () => {
    const before = await adminRead("chapter_progress");
    const { error } = await a.client
      .from("chapter_progress")
      .update({ done_at: null })
      .eq("id", aRows.chapter_progress.id);
    expect(error).toBeNull();
    const after = await adminRead("chapter_progress");
    expect(after?.done_at).toBeNull();
    expect(String(after?.updated_at) > String(before?.updated_at)).toBe(true);
  });

  it("documents.reading_status accepts the three states and null, and rejects others", async () => {
    for (const status of ["to_read", "reading", "finished", null]) {
      const { error } = await a.client
        .from("documents")
        .update({ reading_status: status })
        .eq("id", aRows.documents.id);
      expect(error, String(status)).toBeNull();
    }
    const bad = await a.client
      .from("documents")
      .update({ reading_status: "abandoned" })
      .eq("id", aRows.documents.id);
    expect(bad.error?.code).toBe("23514");
  });
});

describe("storage bucket `documents`", () => {
  const bucket = () => b.client.storage.from(DOCUMENTS_BUCKET);

  it("A downloads its own file (control)", async () => {
    const { data, error } = await a.client.storage.from(DOCUMENTS_BUCKET).download(aObject());
    expect(error).toBeNull();
    expect(new Uint8Array(await (data as Blob).arrayBuffer())).toEqual(pdfBytes);
  });

  it("B can't read A's file", async () => {
    const download = await bucket().download(aObject());
    expect(download.data).toBeNull();
    expect(download.error).not.toBeNull();
    const signed = await bucket().createSignedUrl(aObject(), 60);
    expect(signed.data).toBeNull();
    const listing = await bucket().list(`${a.id}/${aRows.documents.id}`);
    expect(listing.data ?? []).toEqual([]);
  });

  it("the anonymous client can't read A's file", async () => {
    const { data } = await anon.storage.from(DOCUMENTS_BUCKET).download(aObject());
    expect(data).toBeNull();
  });

  it("B can't write, overwrite or delete in A's folder", async () => {
    const write = await bucket().upload(`${a.id}/planted.pdf`, pdfBytes, {
      contentType: "application/pdf",
    });
    expect(write.error).not.toBeNull();
    const overwrite = await bucket().upload(aObject(), pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    expect(overwrite.error).not.toBeNull();
    await bucket().remove([aObject()]);
    const stillThere = await admin.storage.from(DOCUMENTS_BUCKET).download(aObject());
    expect(stillThere.error).toBeNull();
  });

  it("B writes only under its own folder", async () => {
    const own = await bucket().upload(`${b.id}/doc/source.pdf`, pdfBytes, {
      contentType: "application/pdf",
    });
    expect(own.error).toBeNull();
    const root = await bucket().upload(`loose-${randomUUID()}.pdf`, pdfBytes, {
      contentType: "application/pdf",
    });
    expect(root.error).not.toBeNull();
  });

  it("is private", async () => {
    const { data, error } = await admin.storage.getBucket(DOCUMENTS_BUCKET);
    expect(error).toBeNull();
    expect(data?.public).toBe(false);
  });
});

describe("annotation constraints (target by kind)", () => {
  const annotation = (patch: Row): Row => ({
    ...aRows.annotations,
    id: randomUUID(),
    ...patch,
  });

  it.each([
    ["a highlight without a color", { color: null }],
    ["a highlight without quote_text", { quote_text: null }],
    ["a highlight without a target quote", { target: { ...highlightTarget, quote: undefined } }],
    [
      "a bookmark with a color",
      {
        kind: "bookmark",
        quote_text: null,
        target: { fingerprint, segments: [{ page: 0, rects: [] }] },
      },
    ],
    [
      "an area with two rects",
      {
        kind: "area",
        quote_text: null,
        target: {
          fingerprint,
          segments: [
            {
              page: 0,
              rects: [
                [1, 1, 2, 2],
                [3, 3, 4, 4],
              ],
            },
          ],
        },
      },
    ],
    ["a page_start that isn't the first segment's page", { page_start: 5 }],
    ["an unknown kind", { kind: "underline" }],
    ["an unknown color", { color: "yellow" }],
  ])("the database rejects %s", async (_name, patch) => {
    const row = annotation(patch);
    expect(AnnotationShape.safeParse(row).success).toBe(false);
    const { error } = await a.client.from("annotations").insert(row);
    expect(error?.code).toBe("23514");
  });

  it("accepts a valid area and bookmark, and the reserved ink kind", async () => {
    const area = annotation({
      kind: "area",
      color: null,
      quote_text: null,
      target: { fingerprint, segments: [{ page: 0, rects: [[10, 10, 200, 150]] }] },
    });
    const bookmark = annotation({
      kind: "bookmark",
      color: null,
      quote_text: null,
      target: { fingerprint, segments: [{ page: 0, rects: [] }] },
    });
    expect(AnnotationShape.safeParse(area).success).toBe(true);
    expect(AnnotationShape.safeParse(bookmark).success).toBe(true);
    const ink = annotation({ kind: "ink", color: "key", quote_text: null, target: {} });
    const { error } = await a.client.from("annotations").insert([area, bookmark, ink]);
    expect(error).toBeNull();
  });
});

describe("updated_at", () => {
  it("is set by the server on update, whatever the client sends", async () => {
    const stale = "2000-01-01T00:00:00+00:00";
    const { data, error } = await a.client
      .from("collections")
      .update({ name: "Renamed shelf", updated_at: stale })
      .eq("id", aRows.collections.id)
      .select("updated_at")
      .single();
    expect(error).toBeNull();
    const updatedAt = Date.parse(String(data?.updated_at));
    expect(updatedAt).toBeGreaterThan(Date.parse(stale));
    expect(Math.abs(Date.now() - updatedAt)).toBeLessThan(5 * 60_000);
  });
});
