"use client";

import { Button } from "@margin/ui/components/button";
import { toast } from "@margin/ui/components/sonner";
import { useCallback, useEffect, useState } from "react";
import { opfsList, opfsRemove } from "@/lib/documents/opfs";
import { services } from "@/lib/documents/services";
import { useCanInstall } from "@/lib/pwa/pwa";

interface Row {
  id: string;
  title: string;
  size: number;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function StorageSection() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const [files, books] = await Promise.all([
      opfsList(),
      services()
        .documents.list()
        .catch(() => []),
    ]);
    const titles = new Map(books.map((b) => [b.id, b.title]));
    setRows(
      files
        .map((f) => ({ id: f.id, title: titles.get(f.id) ?? "Deleted book", size: f.size }))
        .sort((a, b) => b.size - a.size),
    );
    try {
      const est = await navigator.storage.estimate();
      setQuota({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
      setPersisted((await navigator.storage.persisted?.()) ?? null);
    } catch {
      setQuota(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: Row) {
    await opfsRemove(row.id);
    toast(`Removed "${row.title}" from this device. It stays in your library.`);
    await load();
  }

  const total = (rows ?? []).reduce((sum, r) => sum + r.size, 0);

  return (
    <section className="space-y-3" aria-labelledby="storage-heading" data-testid="storage-section">
      <h2 id="storage-heading" className="font-medium text-lg">
        Storage on this device
      </h2>
      <p className="text-muted-foreground text-sm">
        Books you opened or kept offline are stored here so they open without a network. Removing
        one only frees space on this device; the book stays in your library.
      </p>
      {rows === null ? (
        <p className="text-muted-foreground text-sm">Checking…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
          No books are stored on this device yet. Open a book, or choose Keep offline in its menu.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="storage-list">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-3 p-3 text-sm"
              data-testid="storage-row"
            >
              <span className="min-w-0 flex-1 truncate">{row.title}</span>
              <span className="text-muted-foreground tabular-nums">{formatBytes(row.size)}</span>
              <Button size="sm" variant="outline" onClick={() => void remove(row)}>
                Remove from this device
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-sm" data-testid="storage-total">
        Books on this device: {formatBytes(total)}
        {quota
          ? ` · Browser storage used: ${formatBytes(quota.usage)} of ${formatBytes(quota.quota)}`
          : ""}
        {persisted === true ? " · Protected from automatic clean-up" : ""}
      </p>
    </section>
  );
}

export function InstallSection() {
  const { canInstall, install } = useCanInstall();
  return (
    <section className="space-y-2" aria-labelledby="install-heading">
      <h2 id="install-heading" className="font-medium text-lg">
        Install
      </h2>
      <p className="text-muted-foreground text-sm">
        Install Margin as an app for its own window and offline use.
      </p>
      {canInstall ? (
        <Button onClick={() => void install()} data-testid="install-app">
          Install app
        </Button>
      ) : (
        <p className="text-muted-foreground text-sm">
          Your browser offers installing from its menu, or it is already installed.
        </p>
      )}
    </section>
  );
}
