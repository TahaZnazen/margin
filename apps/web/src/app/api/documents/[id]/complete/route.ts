import { NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/documents/config";
import { createClient } from "@/lib/supabase/server";
import {
  CompleteUploadRequest,
  type CompleteUploadResponse,
  DocumentIdParam,
} from "@/server/contracts/documents";

const BUCKET = "documents";

type Verdict = { ok: true; byteSize: number } | { ok: false; reason: string };

/**
 * Verifies the uploaded object (exists, `%PDF-` magic bytes, size within the cap) and marks the
 * book `readable` or `failed`. RLS applies throughout: it is the signed-in user's own row and folder.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = DocumentIdParam.safeParse((await params).id);
  const body = CompleteUploadRequest.safeParse(await request.json().catch(() => ({})));
  if (!id.success || !body.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: doc } = await supabase
    .from("documents")
    .select("id, storage_path")
    .eq("id", id.data)
    .is("deleted_at", null)
    .maybeSingle<{ id: string; storage_path: string | null }>();
  if (!doc?.storage_path) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const verdict = await inspect(supabase, doc.storage_path);
  const coverPath = doc.storage_path.replace(/source\.pdf$/, "cover.webp");

  if (!verdict.ok) {
    await supabase.from("documents").update({ read_status: "failed" }).eq("id", doc.id);
    return respond({ status: "failed", reason: verdict.reason });
  }

  const hasCover = body.data.hasCover && (await inspectExists(supabase, coverPath));
  const { error } = await supabase
    .from("documents")
    .update({
      read_status: "readable",
      byte_size: verdict.byteSize,
      ...(hasCover ? { cover_path: coverPath } : {}),
    })
    .eq("id", doc.id);
  if (error) return NextResponse.json({ error: "Could not save." }, { status: 500 });
  return respond({ status: "readable", byteSize: verdict.byteSize });
}

const respond = (body: CompleteUploadResponse) => NextResponse.json(body);

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function signedHead(
  supabase: Supabase,
  path: string,
  bytes: string,
): Promise<Response | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60);
  if (!data) return null;
  return fetch(data.signedUrl, { headers: { range: `bytes=${bytes}` }, cache: "no-store" });
}

async function inspectExists(supabase: Supabase, path: string): Promise<boolean> {
  const res = await signedHead(supabase, path, "0-0").catch(() => null);
  return Boolean(res?.ok);
}

async function inspect(supabase: Supabase, path: string): Promise<Verdict> {
  const res = await signedHead(supabase, path, "0-4").catch(() => null);
  if (!res?.ok) return { ok: false, reason: "The file did not arrive in storage. Try again." };
  const head = new TextDecoder().decode(await res.arrayBuffer()).slice(0, 5);
  if (head !== "%PDF-") return { ok: false, reason: "The uploaded file is not a valid PDF." };
  const range = res.headers.get("content-range")?.match(/\/(\d+)$/);
  const byteSize = Number(range?.[1] ?? res.headers.get("content-length"));
  if (!Number.isFinite(byteSize) || byteSize <= 0) {
    return { ok: false, reason: "The uploaded file is empty." };
  }
  if (byteSize > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: `The file is larger than ${MAX_UPLOAD_LABEL}.` };
  }
  return { ok: true, byteSize };
}
