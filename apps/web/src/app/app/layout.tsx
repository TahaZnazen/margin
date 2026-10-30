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
  const userId = typeof data?.claims.sub === "string" ? data.claims.sub : "";
  return (
    <AppShell email={email} userId={userId}>
      {children}
    </AppShell>
  );
}

/** What a hard load shows while the session resolves: the shell's outline, not a blank page. */
function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh bg-background" aria-busy="true">
      <div className="hidden w-52 shrink-0 border-r bg-card p-3 md:block">
        <p className="px-2 pt-1 pb-4 font-semibold font-serif text-xl">Margin</p>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center border-b px-4 md:hidden">
          <p className="font-semibold font-serif text-lg">Margin</p>
        </div>
        <div className="hidden h-12 border-b md:block" />
      </div>
    </div>
  );
}

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <ShellWithUser>{children}</ShellWithUser>
    </Suspense>
  );
}
