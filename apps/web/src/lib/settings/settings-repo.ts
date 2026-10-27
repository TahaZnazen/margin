import type { HighlightColor } from "@margin/annotation-model";
import type { ThemePreference } from "@margin/ui/theme";
import { z } from "zod";

export const ReaderPrefs = z.object({ defaultZoom: z.enum(["fit-width", "fit-page"]) });
export type ReaderPrefs = z.infer<typeof ReaderPrefs>;

export const DEFAULT_READER_PREFS: ReaderPrefs = { defaultZoom: "fit-width" };

export type Settings = {
  theme: ThemePreference;
  /** Only the labels the user renamed; the rest fall back to DEFAULT_HIGHLIGHT_LABELS. */
  highlightLabels: Partial<Record<HighlightColor, string>>;
  readerPrefs: ReaderPrefs;
};

/**
 * Where user settings live. The UI depends only on this interface: P05 implements it with
 * supabase-js, P06 swaps in PowerSync without touching the UI.
 */
export interface SettingsRepo {
  get(): Promise<Settings>;
  save(patch: Partial<Settings>): Promise<void>;
}
