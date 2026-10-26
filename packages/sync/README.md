# @margin/sync — the sync contract

- `src/schema.ts`: the PowerSync client schema (local SQLite views of the Postgres tables).
- `powersync.yaml`: the Sync Config. It uses **Sync Streams** (`config: edition: 3`), PowerSync's GA mechanism; Sync Rules are legacy. It has one auto-subscribed stream, `user_data`, that carries every table filtered by `user_id = auth.user_id()`. That's the same rule RLS applies with `auth.uid()`.
- `src/schema.test.ts` checks that the client schema, `powersync.yaml` and the `powersync` publication (`packages/db/migrations/0003_powersync_publication.sql`) list the same tables and columns as `@margin/db`.

Changing any of these is a contract change: write an ADR first (`docs/adr/`).

## Ready to deploy (P06)

What's already in the database (via `pnpm db:migrate`): logical replication (Supabase default) and the `powersync` publication.

1. **Replication role.** Put a 32+ character random password in `apps/web/.env.local` as `POWERSYNC_DB_PASSWORD`, then run:
   ```
   pnpm db:powersync-role
   ```
   This creates `powersync_role` (REPLICATION, BYPASSRLS, LOGIN) and grants it SELECT on the published tables. It sends Postgres a SCRAM verifier, never the password itself. It's safe to re-run after a migration adds a table to the publication.
2. **Instance.** In the PowerSync dashboard, create an instance for `margin-dev` in the same region as the Supabase project.
   - Database connection: host, port and database from the Supabase **direct** or **session pooler** connection string, with user `powersync_role` and the password above. Set SSL mode to `verify-full` and upload Supabase's CA certificate (Project Settings → Database → SSL Configuration).
   - Client auth: tick **Use Supabase Auth**. PowerSync then reads the JWKS at `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`, with audience `authenticated`.
3. **Sync Config.** Open the instance's Sync Streams editor, paste `packages/sync/powersync.yaml`, click **Validate**, then **Deploy**.

## Validate

Validation needs a PowerSync instance connected to the database, because PowerSync checks the queries against the real tables. P06 does one of these:

- **Dashboard:** Sync Streams editor → paste `powersync.yaml` → **Validate**. Expect no errors and a single stream, `user_data`, with 7 queries.
- **CLI** (beta, `npx powersync@0.10.3`, FSL-1.1-ALv2; run it with npx and don't add it as a dependency):
  ```
  npx powersync@0.10.3 login                       # PAT from the dashboard, or PS_ADMIN_TOKEN in CI
  npx powersync@0.10.3 init cloud                  # scaffolds powersync/service.yaml + sync-config.yaml
  # replace powersync/sync-config.yaml with packages/sync/powersync.yaml
  npx powersync@0.10.3 link cloud --instance-id=<instance-id>
  npx powersync@0.10.3 validate
  npx powersync@0.10.3 deploy sync-config --dry-run
  ```
- **Cross-check the client schema:** `npx powersync@0.10.3 generate schema --output=ts --output-path=generated-schema.ts` should list the same columns as `src/schema.ts` (`id` excepted).
