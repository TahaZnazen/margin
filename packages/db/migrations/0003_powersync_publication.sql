-- Custom migration: PowerSync prerequisite (PowerSync's Supabase guide). Supabase already runs with
-- logical replication; PowerSync replicates the tables in a publication that must be named
-- "powersync". It lists the synced tables explicitly, so server-only tables added in later phases
-- (chunks, AI, billing) are never replicated by accident.
--
-- The replication role with its password is NOT created here: run `pnpm db:powersync-role`
-- once (packages/db/scripts/powersync-role.ts), which reads the password from the environment.
CREATE PUBLICATION powersync FOR TABLE
  public.documents,
  public.reading_state,
  public.annotations,
  public.notes,
  public.collections,
  public.collection_documents,
  public.user_settings;
