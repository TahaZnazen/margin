import type { AnchorStatus, AnnotationTarget, HighlightColor } from "@margin/annotation-model";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Annotation, AnnotationsRepo } from "./annotations-repo";

const COLUMNS =
  "id, document_id, kind, color, target, page_start, quote_text, comment, anchor_status, created_at, updated_at";

type Row = {
  id: string;
  document_id: string;
  kind: Annotation["kind"];
  color: HighlightColor | null;
  target: AnnotationTarget;
  page_start: number;
  quote_text: string | null;
  comment: string | null;
  anchor_status: AnchorStatus;
  created_at: string;
  updated_at: string;
};

const toAnnotation = (row: Row): Annotation => ({
  id: row.id,
  documentId: row.document_id,
  kind: row.kind,
  color: row.color,
  target: row.target,
  pageStart: row.page_start,
  quoteText: row.quote_text,
  comment: row.comment,
  anchorStatus: row.anchor_status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** `AnnotationsRepo` over supabase-js: the signed-in user's own rows, enforced by RLS. */
export function createSupabaseAnnotationsRepo(supabase: SupabaseClient): AnnotationsRepo {
  return {
    async list(documentId) {
      const { data, error } = await supabase
        .from("annotations")
        .select(COLUMNS)
        .eq("document_id", documentId)
        .is("deleted_at", null)
        .order("page_start", { ascending: true })
        .returns<Row[]>();
      if (error) throw new Error(error.message);
      return (data ?? []).map(toAnnotation);
    },

    async save(a) {
      const { data: session } = await supabase.auth.getSession(); // local read, no network
      if (!session.session) throw new Error("Not signed in.");
      const { error } = await supabase.from("annotations").upsert(
        {
          id: a.id,
          user_id: session.session.user.id,
          document_id: a.documentId,
          kind: a.kind,
          color: a.color,
          target: a.target,
          page_start: a.pageStart,
          quote_text: a.quoteText,
          comment: a.comment,
          anchor_status: a.anchorStatus,
          created_at: a.createdAt,
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
        .from("annotations")
        .update({ deleted_at: now, updated_at: now })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}
