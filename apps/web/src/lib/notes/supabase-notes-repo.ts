import type { SupabaseClient } from "@supabase/supabase-js";
import type { Note, NotesRepo } from "./notes-repo";

const COLUMNS = "id, document_id, title, doc_json, plain_text, created_at, updated_at";

type Row = {
  id: string;
  document_id: string | null;
  title: string | null;
  doc_json: unknown;
  plain_text: string | null;
  created_at: string;
  updated_at: string;
};

const toNote = (r: Row): Note => ({
  id: r.id,
  documentId: r.document_id,
  title: r.title,
  docJson: r.doc_json,
  plainText: r.plain_text ?? "",
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function createSupabaseNotesRepo(supabase: SupabaseClient): NotesRepo {
  const live = () => supabase.from("notes").select(COLUMNS).is("deleted_at", null);
  return {
    async getForDocument(documentId) {
      const { data, error } = await live()
        .eq("document_id", documentId)
        .order("created_at", { ascending: true })
        .limit(1)
        .returns<Row[]>();
      if (error) throw new Error(error.message);
      return data?.[0] ? toNote(data[0]) : null;
    },

    async list() {
      const { data, error } = await live()
        .order("updated_at", { ascending: false })
        .returns<Row[]>();
      if (error) throw new Error(error.message);
      return (data ?? []).map(toNote);
    },

    async get(id) {
      const { data, error } = await live().eq("id", id).returns<Row[]>();
      if (error) throw new Error(error.message);
      return data?.[0] ? toNote(data[0]) : null;
    },

    async save(n) {
      const { data: session } = await supabase.auth.getSession(); // local read, no network
      if (!session.session) throw new Error("Not signed in.");
      const { error } = await supabase.from("notes").upsert(
        {
          id: n.id,
          user_id: session.session.user.id,
          document_id: n.documentId,
          title: n.title,
          doc_json: n.docJson,
          plain_text: n.plainText,
          created_at: n.createdAt,
          updated_at: new Date().toISOString(),
          deleted_at: null,
        },
        { onConflict: "id" },
      );
      if (error) throw new Error(error.message);
    },

    async remove(id) {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("notes")
        .update({ deleted_at: now, updated_at: now })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}
