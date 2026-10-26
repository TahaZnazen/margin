import { describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkSupabaseHealth } from "./health";

// Runs against the dev Supabase project (margin-dev). See test/setup.integration.ts.
describe("Supabase dev project", () => {
  it("Auth health check is OK with the publishable key", async () => {
    await expect(checkSupabaseHealth()).resolves.toMatchObject({ ok: true });
  });

  it("accepts the secret key through the admin client", async () => {
    const { error } = await createAdminClient().auth.admin.listUsers({ page: 1, perPage: 1 });
    expect(error).toBeNull();
  });
});
