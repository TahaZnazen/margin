/// <reference lib="esnext" />
/// <reference lib="webworker" />
// Margin's service worker (Serwist). It makes `/app` and the reader open with the network off after
// one online visit. It only ever touches same-origin GET requests: Supabase, PowerSync and signed
// storage URLs are other origins, and `/api/*` is never cached, so no account data is stored here.
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  type RouteHandlerCallbackOptions,
  Serwist,
  type SerwistPlugin,
} from "serwist";

import { ASSETS_CACHE, PAGES_CACHE } from "../src/lib/pwa/constants";

declare const self: ServiceWorkerGlobalScope;

/** Only complete same-origin answers: never an opaque redirect (signed out) or an error page. */
const basicOkOnly: SerwistPlugin = {
  cacheWillUpdate: async ({ response }) =>
    response.status === 200 && response.type === "basic" ? response : null,
};

const pages = new NetworkFirst({
  cacheName: PAGES_CACHE,
  networkTimeoutSeconds: 4,
  matchOptions: { ignoreVary: true },
  plugins: [basicOkOnly],
});

/** Navigations: network first, so a deploy or a new session is never hidden; cache when offline. */
async function handlePage(options: RouteHandlerCallbackOptions): Promise<Response> {
  try {
    return await pages.handle(options);
  } catch {
    // A page never visited online (e.g. a book not opened yet): fall back to the library shell,
    // which still shows the local library.
    const cache = await caches.open(PAGES_CACHE);
    const shell = await cache.match("/app", { ignoreVary: true });
    return shell ?? Response.error();
  }
}

const assets = new CacheFirst({
  cacheName: ASSETS_CACHE,
  plugins: [
    basicOkOnly,
    new ExpirationPlugin({
      maxEntries: 600,
      maxAgeSeconds: 60 * 24 * 60 * 60,
      purgeOnQuotaError: true,
    }),
  ],
});

const ASSET_PREFIXES = ["/_next/static/", "/pdfjs/", "/@powersync/", "/icons/"];

const serwist = new Serwist({
  skipWaiting: true,
  // No clientsClaim: taking over a page mid-session (its workers, its uploads) is what flakes.
  // The first visit is covered by the page-side warm-up; the next load is controlled.
  clientsClaim: false,
  navigationPreload: false,
  disableDevLogs: true,
  runtimeCaching: [
    {
      matcher: ({ request, sameOrigin, url }) =>
        sameOrigin &&
        request.method === "GET" &&
        ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)),
      handler: assets,
    },
    {
      matcher: ({ request, sameOrigin, url }) =>
        sameOrigin &&
        request.mode === "navigate" &&
        (url.pathname === "/app" || url.pathname.startsWith("/app/")),
      handler: handlePage,
    },
  ],
});

serwist.addEventListeners();
