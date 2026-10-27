"use server";

import { z } from "zod";
import { signupsAllowed } from "@/env";
import { createClient } from "@/lib/supabase/server";

const credentials = z.object({ email: z.email(), password: z.string().min(8) });

export type SignUpResult =
  | { error: string; needsConfirmation?: undefined }
  | { error: null; needsConfirmation: boolean };

/** Server-side so the ALLOW_SIGNUPS flag can't be bypassed from the browser form. */
export async function signUp(input: { email: string; password: string }): Promise<SignUpResult> {
  if (!signupsAllowed()) return { error: "Sign-ups are closed." };
  const parsed = credentials.safeParse(input);
  if (!parsed.success) return { error: "Enter a valid email and a password of 8+ characters." };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp(parsed.data);
  if (error) return { error: error.message };
  return { error: null, needsConfirmation: !data.session };
}
