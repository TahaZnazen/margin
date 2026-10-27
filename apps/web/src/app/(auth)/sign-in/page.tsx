import { connection } from "next/server";
import { Suspense } from "react";
import { signupsAllowed } from "@/env";
import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in · Margin" };

async function Form() {
  await connection(); // ALLOW_SIGNUPS is read per request, not frozen at build time.
  return <SignInForm allowSignups={signupsAllowed()} />;
}

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="font-serif font-semibold text-3xl tracking-tight">Margin</h1>
        <Suspense fallback={null}>
          <Form />
        </Suspense>
      </div>
    </main>
  );
}
