/**
 * Feature flags for the personal MVP. They stand in for PostHog flags until the beta
 * (see prompts/README.md, "MVP simplifications"). Unfinished user-visible features stay off.
 */
export const flags = {
  ai: false,
  billing: false,
} as const satisfies Record<string, boolean>;

export type Flag = keyof typeof flags;
