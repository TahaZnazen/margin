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
