import { connection } from "next/server";
import { Suspense } from "react";
import { checkSupabaseHealth } from "@/server/health";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="font-semibold text-4xl tracking-tight">Margin</h1>
      <Suspense fallback={<p className="text-muted-foreground text-sm">Supabase: checking…</p>}>
        <SupabaseHealth />
      </Suspense>
    </main>
  );
}

async function SupabaseHealth() {
  // Check on every request, never at build time.
  await connection();
  const health = await checkSupabaseHealth();
  return health.ok ? (
    <HealthLine status="ok" label="OK" detail={`${health.latencyMs} ms`} />
  ) : (
    <HealthLine status="fail" label="FAIL" detail={health.reason} />
  );
}

function HealthLine({
  status,
  label,
  detail,
}: {
  status: "ok" | "fail";
  label: string;
  detail?: string;
}) {
  return (
    <p className="text-muted-foreground text-sm" data-testid="supabase-health" data-status={status}>
      Supabase: <strong className="text-foreground">{label}</strong>
      {detail ? <span> · {detail}</span> : null}
    </p>
  );
}
