"use client";

import { dismissSyncError, type SyncState, useSyncSummary } from "@margin/sync/client";
import { Button } from "@margin/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@margin/ui/components/popover";
import { cn } from "@margin/ui/lib/utils";
import { CloudCheckIcon, CloudOffIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";

const LABEL: Record<SyncState, string> = {
  synced: "Synced",
  syncing: "Syncing…",
  offline: "Offline: changes are saved on this device",
  error: "Some changes could not be saved to your account",
};

function Indicator({ className }: { className?: string }) {
  const { state, errors } = useSyncSummary();
  const Icon = {
    synced: CloudCheckIcon,
    syncing: RefreshCwIcon,
    offline: CloudOffIcon,
    error: TriangleAlertIcon,
  }[state];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Sync status: ${LABEL[state]}`}
          title={LABEL[state]}
          data-testid="sync-status"
          data-state={state}
          className={cn(state === "error" && "text-destructive", className)}
        >
          <Icon className={cn(state === "syncing" && "animate-spin")} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-sm">
        <p className="font-medium">{LABEL[state]}</p>
        {errors.length > 0 ? (
          <ul className="mt-2 space-y-2" data-testid="sync-errors">
            {errors.map((e) => (
              <li key={e.id} className="rounded-md border p-2">
                <p className="font-medium">
                  {e.table_name} · {e.op}
                </p>
                <p className="text-muted-foreground text-xs">{e.message}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1"
                  onClick={() => void dismissSyncError(e.id)}
                >
                  Dismiss
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted-foreground text-xs">
            Everything you write is stored on this device first, then synced in the background.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Sync state in the top bar: synced, syncing, offline or errors (the popover lists them). */
export function SyncStatus({ className }: { className?: string }) {
  // The sync hooks need the browser database: render them after mount only.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <Indicator className={className} /> : <div className="size-8" aria-hidden />;
}
