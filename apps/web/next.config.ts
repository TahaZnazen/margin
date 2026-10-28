import type { NextConfig } from "next";

// NEXT_PUBLIC_ values are inlined into the browser bundle, so refuse to build with a secret key in one.
for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith("NEXT_PUBLIC_") && value?.startsWith("sb_secret_")) {
    throw new Error(
      `${name} holds a Supabase secret key, which would ship to the browser. Use SUPABASE_SECRET_KEY.`,
    );
  }
}

const nextConfig: NextConfig = {
  // Overridable so scripts/check-server-only.mjs can build without touching .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  // A personal app: the home page is the library. Signed-out visitors go on to /sign-in (proxy.ts).
  async redirects() {
    return [{ source: "/", destination: "/app", permanent: false }];
  },
  experimental: {
    // Turbopack's on-disk build cache served a stale module after a merge (an E2E saw old code).
    // Turbo already caches whole builds, so production builds always compile from scratch.
    turbopackFileSystemCacheForBuild: false,
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
