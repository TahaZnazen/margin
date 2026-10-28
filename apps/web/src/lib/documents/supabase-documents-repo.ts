import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Book,
  BookPatch,
  DocumentsRepo,
  ReadingState,
  ReadingStateRepo,
  ReadStatus,
} from "./documents-repo";

const COLUMNS =
  "id, title, author, sha256, byte_size, page_count, storage_path, cover_path, has_text_layer, read_status, last_opened_at, created_at, annotations_imported_at";

type Row = {
  id: string;
  title: string;
  author: string | null;
  sha256: string;
  byte_size: number | null;
  page_count: number | null;
  storage_path: string | null;
  cover_path: string | null;
  has_text_layer: boolean | null;
  read_status: ReadStatus;
  last_opened_at: string | null;
  created_at: string;
  annotations_imported_at: string | null;
};

const toBook = (row: Row, percent = 0): Book => ({
  id: row.id,
  title: row.title,
  author: row.author,
  sha256: row.sha256,
  byteSize: row.byte_size,
  pageCount: row.page_count,
  storagePath: row.storage_path,
  coverPath: row.cover_path,
  hasTextLayer: row.has_text_layer,
  readStatus: row.read_status,
  lastOpenedAt: row.last_opened_at,
  createdAt: row.created_at,
  annotationsImportedAt: row.annotations_imported_at,
  percent,
});

async function userId(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.auth.getSession(); // local read, no network
  if (!data.session) throw new Error("Not signed in.");
  return data.session.user.id;
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

/** `DocumentsRepo` over supabase-js: the signed-in user's own rows, enforced by RLS. */
export function createSupabaseDocumentsRepo(supabase: SupabaseClient): DocumentsRepo {
  const live = () => supabase.from("documents").select(COLUMNS).is("deleted_at", null);
  return {
    async list() {
      const [docs, states] = await Promise.all([
        live().order("created_at", { ascending: false }).returns<Row[]>(),
        supabase
          .from("reading_state")
          .select("document_id, percent")
          .is("deleted_at", null)
          .returns<{ document_id: string; percent: number | null }[]>(),
      ]);
      fail(docs.error);
      fail(states.error);
      const percents = new Map((states.data ?? []).map((s) => [s.document_id, s.percent ?? 0]));
      return (docs.data ?? []).map((row) => toBook(row, percents.get(row.id) ?? 0));
    },

    async get(id) {
      const { data, error } = await live().eq("id", id).maybeSingle<Row>();
      fail(error);
      return data ? toBook(data) : null;
    },

    async findBySha(sha256) {
      const { data, error } = await live().eq("sha256", sha256).maybeSingle<Row>();
      fail(error);
      return data ? toBook(data) : null;
    },

    async create(book) {
      const { error } = await supabase.from("documents").insert({
        id: book.id,
        user_id: await userId(supabase),
        title: book.title,
        sha256: book.sha256,
        byte_size: book.byteSize,
        storage_path: book.storagePath,
        read_status: "uploading",
      });
      fail(error);
    },

    async update(id, patch: BookPatch) {
      const row: Record<string, unknown> = {};
      if (patch.title !== undefined) row.title = patch.title;
      if (patch.author !== undefined) row.author = patch.author;
      if (patch.lastOpenedAt !== undefined) row.last_opened_at = patch.lastOpenedAt;
      if (patch.coverPath !== undefined) row.cover_path = patch.coverPath;
      if (patch.pageCount !== undefined) row.page_count = patch.pageCount;
      if (patch.hasTextLayer !== undefined) row.has_text_layer = patch.hasTextLayer;
      if (patch.outline !== undefined) row.outline = patch.outline;
      const { error } = await supabase.from("documents").update(row).eq("id", id);
      fail(error);
    },

    async claimImport(id) {
      const { data, error } = await supabase
        .from("documents")
        .update({ annotations_imported_at: new Date().toISOString() })
        .eq("id", id)
        .is("annotations_imported_at", null)
        .select("id");
      fail(error);
      return (data?.length ?? 0) > 0;
    },

    async softDelete(id) {
      const { error } = await supabase
        .from("documents")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      fail(error);
    },

    async restore(id) {
      const { error } = await supabase.from("documents").update({ deleted_at: null }).eq("id", id);
      fail(error);
    },
  };
}

export function createSupabaseReadingStateRepo(supabase: SupabaseClient): ReadingStateRepo {
  // Latest position saved on this device. Saves are fire-and-forget, so a quick reopen can race
  // the upsert and read an older row; this device's own latest write always wins over it.
  const latest = new Map<string, ReadingState>();
  return {
    async get(documentId) {
      const local = latest.get(documentId);
      if (local) return local;
      const { data, error } = await supabase
        .from("reading_state")
        .select("page, offset_pt, zoom, percent, seconds_read")
        .eq("document_id", documentId)
        .is("deleted_at", null)
        .maybeSingle();
      fail(error);
      if (!data) return null;
      return {
        page: data.page,
        offsetPt: data.offset_pt,
        zoom: data.zoom,
        percent: data.percent,
        secondsRead: data.seconds_read,
      } satisfies ReadingState;
    },

    async save(documentId, state) {
      latest.set(documentId, state);
      const { error } = await supabase.from("reading_state").upsert(
        {
          user_id: await userId(supabase),
          document_id: documentId,
          page: state.page,
          offset_pt: state.offsetPt,
          zoom: state.zoom,
          percent: state.percent,
          seconds_read: state.secondsRead,
          deleted_at: null,
        },
        { onConflict: "user_id,document_id" },
      );
      fail(error);
    },
  };
}
