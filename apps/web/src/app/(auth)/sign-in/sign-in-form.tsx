"use client";

import { Button } from "@margin/ui/components/button";
import { Input } from "@margin/ui/components/input";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { signUp } from "./actions";

type Mode = "password" | "magic" | "signup";

const MODE_LABEL: Record<Mode, string> = {
  password: "Sign in",
  magic: "Email me a link",
  signup: "Sign up",
};

export function SignInForm({ allowSignups }: { allowSignups: boolean }) {
  const router = useRouter();
  const linkFailed = useSearchParams().get("error") === "link";
  const [mode, setMode] = useState<Mode>("password");
  const [message, setMessage] = useState<string | null>(
    linkFailed ? "That link has expired. Request a new one." : null,
  );
  const [isError, setIsError] = useState(linkFailed);
  const [busy, setBusy] = useState(false);

  function report(text: string, error: boolean) {
    setMessage(text);
    setIsError(error);
  }

  async function run(email: string, password: string) {
    const supabase = createClient();
    if (mode === "password") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return report("Wrong email or password.", true);
    } else if (mode === "magic") {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          shouldCreateUser: false,
        },
      });
      if (error) return report(error.message, true);
      return report("Check your email for the sign-in link.", false);
    } else {
      const result = await signUp({ email, password });
      if (result.error) return report(result.error, true);
      if (result.needsConfirmation) return report("Check your email to confirm.", false);
    }
    router.replace("/app");
    router.refresh();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage(null);
    try {
      await run(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
    } finally {
      setBusy(false);
    }
  }

  const switchTo = (target: Mode, label: string) => (
    <Button
      type="button"
      variant="link"
      className="h-auto p-0"
      onClick={() => {
        setMode(target);
        setMessage(null);
      }}
    >
      {label}
    </Button>
  );

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4"
      aria-label={mode === "signup" ? "Create your account" : "Sign in"}
    >
      <h2 className="font-medium text-lg">
        {mode === "signup" ? "Create your account" : "Sign in"}
      </h2>
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm">
          Email
        </label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {mode !== "magic" && (
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm">
            Password
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={8}
            required
          />
        </div>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {MODE_LABEL[mode]}
      </Button>
      {message && (
        <p
          role="status"
          className={isError ? "text-destructive text-sm" : "text-muted-foreground text-sm"}
        >
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {mode !== "password" && switchTo("password", "Use password")}
        {mode !== "magic" && switchTo("magic", "Email me a magic link")}
        {allowSignups && mode !== "signup" && switchTo("signup", "Create an account")}
      </div>
    </form>
  );
}
