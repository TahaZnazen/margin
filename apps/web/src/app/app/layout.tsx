import { connection } from "next/server";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "./app-shell";

export const metadata = { title: "Margin", robots: { index: false, follow: false } };

async function ShellWithUser({ children }: { children: React.ReactNode }) {
  await connection(); // per-request: the session cookie decides what renders
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims.email === "string" ? data.claims.email : "";
  return <AppShell email={email}>{children}</AppShell>;
}

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <ShellWithUser>{children}</ShellWithUser>
    </Suspense>
  );
}
