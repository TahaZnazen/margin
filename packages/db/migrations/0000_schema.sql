CREATE TABLE "annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"color" text,
	"target" jsonb NOT NULL,
	"page_start" integer NOT NULL,
	"quote_text" text,
	"comment" text,
	"snapshot_path" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"anchor_status" text DEFAULT 'anchored' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "annotations_kind_check" CHECK ("annotations"."kind" in ('highlight', 'area', 'bookmark', 'ink')),
	CONSTRAINT "annotations_color_check" CHECK ("annotations"."color" in ('key', 'definition', 'example', 'memorize', 'confusing')),
	CONSTRAINT "annotations_anchor_status_check" CHECK ("annotations"."anchor_status" in ('anchored', 'reanchored', 'orphaned')),
	CONSTRAINT "annotations_highlight_check" CHECK ("annotations"."kind" <> 'highlight' or ("annotations"."color" is not null and "annotations"."quote_text" is not null and "annotations"."quote_text" <> '')),
	CONSTRAINT "annotations_area_check" CHECK ("annotations"."kind" <> 'area' or "annotations"."quote_text" is null),
	CONSTRAINT "annotations_bookmark_check" CHECK ("annotations"."kind" <> 'bookmark' or ("annotations"."color" is null and "annotations"."quote_text" is null)),
	CONSTRAINT "annotations_target_check" CHECK (case
        when "annotations"."kind" = 'ink' then jsonb_typeof("annotations"."target") = 'object'
        when coalesce(jsonb_typeof("annotations"."target" -> 'segments'), '') <> 'array'
          or coalesce(jsonb_typeof("annotations"."target" #> '{segments,0,rects}'), '') <> 'array'
          then false
        else ("annotations"."target" #>> '{segments,0,page}') = "annotations"."page_start"::text
          and case "annotations"."kind"
            when 'highlight' then "annotations"."target" ? 'quote'
              and jsonb_array_length("annotations"."target" #> '{segments,0,rects}') >= 1
            when 'area' then not ("annotations"."target" ? 'quote')
              and jsonb_array_length("annotations"."target" -> 'segments') = 1
              and jsonb_array_length("annotations"."target" #> '{segments,0,rects}') = 1
            else not ("annotations"."target" ? 'quote')
              and jsonb_array_length("annotations"."target" -> 'segments') = 1
              and jsonb_array_length("annotations"."target" #> '{segments,0,rects}') <= 1
          end
      end)
);
--> statement-breakpoint
ALTER TABLE "annotations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "collection_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "collection_documents_collection_id_document_id_key" UNIQUE("collection_id","document_id")
);
--> statement-breakpoint
ALTER TABLE "collection_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "collections_user_id_id_key" UNIQUE("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"sha256" text NOT NULL,
	"byte_size" bigint,
	"page_count" integer,
	"storage_path" text,
	"cover_path" text,
	"has_text_layer" boolean,
	"language" text,
	"outline" jsonb,
	"read_status" text DEFAULT 'uploading' NOT NULL,
	"ai_status" text DEFAULT 'none' NOT NULL,
	"annotations_imported_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "documents_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "documents_sha256_check" CHECK ("documents"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "documents_read_status_check" CHECK ("documents"."read_status" in ('uploading', 'readable', 'failed')),
	CONSTRAINT "documents_ai_status_check" CHECK ("documents"."ai_status" in ('none', 'pending', 'processing', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid,
	"title" text,
	"doc_json" jsonb,
	"plain_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reading_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"page" integer DEFAULT 0 NOT NULL,
	"offset_pt" real,
	"zoom" real,
	"percent" real,
	"seconds_read" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "reading_state_user_id_document_id_key" UNIQUE("user_id","document_id")
);
--> statement-breakpoint
ALTER TABLE "reading_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"highlight_labels" jsonb,
	"reader_prefs" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "user_settings_user_id_key" UNIQUE("user_id"),
	CONSTRAINT "user_settings_theme_check" CHECK ("user_settings"."theme" in ('light', 'sepia', 'dark', 'system'))
);
--> statement-breakpoint
ALTER TABLE "user_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_document_fk" FOREIGN KEY ("user_id","document_id") REFERENCES "public"."documents"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_documents" ADD CONSTRAINT "collection_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_documents" ADD CONSTRAINT "collection_documents_collection_fk" FOREIGN KEY ("user_id","collection_id") REFERENCES "public"."collections"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_documents" ADD CONSTRAINT "collection_documents_document_fk" FOREIGN KEY ("user_id","document_id") REFERENCES "public"."documents"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_document_fk" FOREIGN KEY ("user_id","document_id") REFERENCES "public"."documents"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_state" ADD CONSTRAINT "reading_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_state" ADD CONSTRAINT "reading_state_document_fk" FOREIGN KEY ("user_id","document_id") REFERENCES "public"."documents"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annotations_user_id_document_id_page_start_idx" ON "annotations" USING btree ("user_id","document_id","page_start");--> statement-breakpoint
CREATE INDEX "collection_documents_user_id_collection_id_idx" ON "collection_documents" USING btree ("user_id","collection_id");--> statement-breakpoint
CREATE INDEX "collection_documents_user_id_document_id_idx" ON "collection_documents" USING btree ("user_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_user_id_sha256_key" ON "documents" USING btree ("user_id","sha256") WHERE "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "notes_user_id_document_id_idx" ON "notes" USING btree ("user_id","document_id");--> statement-breakpoint
CREATE POLICY "annotations_select_own" ON "annotations" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("annotations"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "annotations_insert_own" ON "annotations" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("annotations"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "annotations_update_own" ON "annotations" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("annotations"."user_id" = (select auth.uid())) WITH CHECK ("annotations"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "annotations_delete_own" ON "annotations" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("annotations"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "collection_documents_select_own" ON "collection_documents" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("collection_documents"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "collection_documents_insert_own" ON "collection_documents" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("collection_documents"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "collection_documents_update_own" ON "collection_documents" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("collection_documents"."user_id" = (select auth.uid())) WITH CHECK ("collection_documents"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "collection_documents_delete_own" ON "collection_documents" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("collection_documents"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "collections_select_own" ON "collections" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("collections"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "collections_insert_own" ON "collections" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("collections"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "collections_update_own" ON "collections" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("collections"."user_id" = (select auth.uid())) WITH CHECK ("collections"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "collections_delete_own" ON "collections" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("collections"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "documents_select_own" ON "documents" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("documents"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "documents_insert_own" ON "documents" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("documents"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "documents_update_own" ON "documents" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("documents"."user_id" = (select auth.uid())) WITH CHECK ("documents"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "documents_delete_own" ON "documents" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("documents"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "notes_select_own" ON "notes" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("notes"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "notes_insert_own" ON "notes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("notes"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "notes_update_own" ON "notes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("notes"."user_id" = (select auth.uid())) WITH CHECK ("notes"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "notes_delete_own" ON "notes" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("notes"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "reading_state_select_own" ON "reading_state" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("reading_state"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "reading_state_insert_own" ON "reading_state" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("reading_state"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "reading_state_update_own" ON "reading_state" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("reading_state"."user_id" = (select auth.uid())) WITH CHECK ("reading_state"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "reading_state_delete_own" ON "reading_state" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("reading_state"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "user_settings_select_own" ON "user_settings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("user_settings"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "user_settings_insert_own" ON "user_settings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("user_settings"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "user_settings_update_own" ON "user_settings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("user_settings"."user_id" = (select auth.uid())) WITH CHECK ("user_settings"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "user_settings_delete_own" ON "user_settings" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("user_settings"."user_id" = (select auth.uid()));