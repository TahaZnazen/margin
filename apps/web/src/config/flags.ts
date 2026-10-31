/**
 * Feature flags for the personal MVP. They stand in for PostHog flags until the beta
 * (see prompts/README.md, "MVP simplifications"). Unfinished user-visible features stay off.
 *
 * `NEXT_PUBLIC_MARGIN_FLAGS` turns flags on at BUILD time (it is inlined into the client bundle):
 * a comma-separated list of flag names, e.g. `NEXT_PUBLIC_MARGIN_FLAGS=chapterProgress`.
 * Unknown names and stray spaces are ignored.
 *
 * `chapterProgress` (C1: chapter checks, reading status) stays off in production until the
 * PowerSync stream with `chapter_progress` is deployed in the PowerSync dashboard; then the
 * founder flips the default below to `true`.
 */
export function parseFlagList(raw: string | undefined): ReadonlySet<string> {
  if (typeof raw !== "string") return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// Must read `process.env.NEXT_PUBLIC_MARGIN_FLAGS` literally so Next.js inlines it.
const enabled = parseFlagList(process.env.NEXT_PUBLIC_MARGIN_FLAGS);

export const flags = {
  ai: false,
  billing: false,
  chapterProgress: enabled.has("chapterProgress"),
} as const satisfies Record<string, boolean>;

export type Flag = keyof typeof flags;
