/**
 * The /dev/* pages (design system gallery, reader mock) exist for development and E2E only.
 *
 * They are on in `next dev` and in local production builds (E2E runs `next start`), and off on
 * the production deployment (Vercel sets VERCEL_ENV=production, at build and at runtime).
 */
export function devRoutesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV !== "production";
}
