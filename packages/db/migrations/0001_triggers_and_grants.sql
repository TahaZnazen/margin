-- Custom migration (drizzle-kit can't express triggers or grants).

-- updated_at is set by the server on every update, whatever the client sends.
CREATE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER documents_set_updated_at BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER reading_state_set_updated_at BEFORE UPDATE ON public.reading_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER annotations_set_updated_at BEFORE UPDATE ON public.annotations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER notes_set_updated_at BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER collections_set_updated_at BEFORE UPDATE ON public.collections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER collection_documents_set_updated_at BEFORE UPDATE ON public.collection_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER user_settings_set_updated_at BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

-- Table privileges, explicit rather than inherited from Supabase's default privileges.
-- anon gets nothing. authenticated gets plain row access (no TRUNCATE, REFERENCES or TRIGGER);
-- RLS still limits it to its own rows. service_role (the secret key) is for trusted server work.
REVOKE ALL ON TABLE
  public.documents, public.reading_state, public.annotations, public.notes,
  public.collections, public.collection_documents, public.user_settings
FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.documents, public.reading_state, public.annotations, public.notes,
  public.collections, public.collection_documents, public.user_settings
TO authenticated, service_role;
