"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ASSETS_CACHE, PAGES_CACHE } from "./constants";

/** The browser's install prompt, kept until the user picks "Install app". */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** True while the browser offers an install prompt (not installed yet, not dismissed). */
export function useCanInstall(): { canInstall: boolean; install: () => Promise<void> } {
  const canInstall = useSyncExternalStore(
    subscribe,
    () => deferred !== null && !installed,
    () => false,
  );
  return {
    canInstall,
    install: async () => {
      const event = deferred;
      if (!event) return;
      deferred = null;
      emit();
      await event.prompt();
      await event.userChoice.catch(() => undefined);
    },
  };
}

/** Same-origin GET into a cache, only when it is a plain 200 (never a sign-in redirect). */
async function warm(cacheName: string, url: string): Promise<void> {
  const cache = await caches.open(cacheName);
  if (await cache.match(url, { ignoreVary: true })) return;
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.ok && !res.redirected) await cache.put(url, res);
}

/** Stores a signed-in app page (e.g. a reader route) so it opens offline. */
export async function warmPage(path: string): Promise<void> {
  if (!path.startsWith("/app")) return;
  await warm(PAGES_CACHE, path);
}

/** Wipes what the service worker stored of the signed-in session (sign-out on a shared device). */
export async function clearOfflinePages(): Promise<void> {
  try {
    await caches.delete(PAGES_CACHE);
  } catch {
    // Cache API unavailable: nothing was stored.
  }
}

async function warmUp(): Promise<void> {
  const here = window.location.pathname;
  const pages = new Set(["/app", here]);
  await Promise.all(
    [...pages].filter((p) => p.startsWith("/app")).map((p) => warm(PAGES_CACHE, p)),
  );
  // Assets the page already loaded before the worker took control, so they are cached too.
  const loaded = performance
    .getEntriesByType("resource")
    .map((e) => new URL(e.name, window.location.href))
    .filter((u) => u.origin === window.location.origin && u.pathname.startsWith("/_next/static/"))
    .map((u) => u.pathname + u.search);
  const manifest = (await (await fetch("/offline-assets.json", { cache: "no-store" })).json()) as {
    urls: string[];
  };
  for (const url of [...loaded, ...manifest.urls]) await warm(ASSETS_CACHE, url).catch(() => {});
}

/**
 * Registers the service worker (production builds only), warms the offline cache once it is
 * active, asks the browser not to evict our storage, and keeps the install prompt for the UI.
 * Mounted inside the signed-in app shell, so signed-out pages are never cached.
 */
export function PwaRegister() {
  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      deferred = event as InstallPromptEvent;
      emit();
    };
    const onInstalled = () => {
      installed = true;
      deferred = null;
      emit();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    try {
      if (!localStorage.getItem("margin.storage.persist")) {
        localStorage.setItem("margin.storage.persist", "1");
        void navigator.storage?.persist?.();
      }
    } catch {
      // Blocked storage: ask again next time.
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then(() => navigator.serviceWorker.ready)
        .then(() => {
          // After the page has settled, so the warm-up never competes with the first render.
          timer = setTimeout(() => {
            warmUp()
              .catch(() => {})
              .finally(() => {
                document.documentElement.dataset.offlineReady = "true";
              });
          }, 1500);
        })
        .catch(() => {
          // No service worker (private window, unsupported): the app still works online.
        });
    }
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}
