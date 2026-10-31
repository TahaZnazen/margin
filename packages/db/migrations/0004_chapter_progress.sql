CREATE TABLE "chapter_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"chapter_key" text NOT NULL,
	"title" text NOT NULL,
	"page_start" integer NOT NULL,
	"done_at" timestamp with time zone,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "chapter_progress_user_id_document_id_chapter_key_key" UNIQUE("user_id","document_id","chapter_key"),
	CONSTRAINT "chapter_progress_source_check" CHECK ("chapter_progress"."source" in ('manual', 'auto'))
);
--> statement-breakpoint
ALTER TABLE "chapter_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "reading_status" text;--> statement-breakpoint
ALTER TABLE "chapter_progress" ADD CONSTRAINT "chapter_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_progress" ADD CONSTRAINT "chapter_progress_document_fk" FOREIGN KEY ("user_id","document_id") REFERENCES "public"."documents"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_reading_status_check" CHECK ("documents"."reading_status" in ('to_read', 'reading', 'finished'));--> statement-breakpoint
CREATE POLICY "chapter_progress_select_own" ON "chapter_progress" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("chapter_progress"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "chapter_progress_insert_own" ON "chapter_progress" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("chapter_progress"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "chapter_progress_update_own" ON "chapter_progress" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("chapter_progress"."user_id" = (select auth.uid())) WITH CHECK ("chapter_progress"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "chapter_progress_delete_own" ON "chapter_progress" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("chapter_progress"."user_id" = (select auth.uid()));--> statement-breakpoint

-- Custom additions (drizzle-kit does not generate these; see 0001 and 0003). Strictly additive (ADR 0004).

-- updated_at is set by the server on every update, whatever the client sends.
CREATE TRIGGER chapter_progress_set_updated_at BEFORE UPDATE ON public.chapter_progress
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

-- Same explicit privileges as the other tables: anon nothing, authenticated plain row access.
REVOKE ALL ON TABLE public.chapter_progress FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chapter_progress TO authenticated, service_role;
--> statement-breakpoint

-- Replicate to PowerSync clients.
ALTER PUBLICATION powersync ADD TABLE public.chapter_progress;
