import { HIGHLIGHT_COLORS, type HighlightColor } from "@margin/annotation-model";
import { isThemePreference } from "@margin/ui/theme";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_READER_PREFS,
  ReaderPrefs,
  type Settings,
  type SettingsRepo,
} from "./settings-repo";

function parseLabels(raw: unknown): Settings["highlightLabels"] {
  const labels: Settings["highlightLabels"] = {};
  if (raw && typeof raw === "object") {
    for (const color of HIGHLIGHT_COLORS satisfies readonly HighlightColor[]) {
      const value = (raw as Record<string, unknown>)[color];
      if (typeof value === "string" && value.trim()) labels[color] = value;
    }
  }
  return labels;
}

/** `SettingsRepo` over supabase-js: the signed-in user's own row, enforced by RLS. */
export function createSupabaseSettingsRepo(supabase: SupabaseClient): SettingsRepo {
  return {
    async get() {
      const { data, error } = await supabase
        .from("user_settings")
        .select("theme, highlight_labels, reader_prefs")
        .maybeSingle();
      if (error) throw new Error(error.message);
      const prefs = ReaderPrefs.safeParse(data?.reader_prefs);
      return {
        theme: isThemePreference(data?.theme) ? data.theme : "system",
        highlightLabels: parseLabels(data?.highlight_labels),
        readerPrefs: prefs.success ? prefs.data : DEFAULT_READER_PREFS,
      };
    },

    async save(patch) {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not signed in.");
      const row: Record<string, unknown> = {
        user_id: auth.user.id,
        updated_at: new Date().toISOString(),
      };
      if (patch.theme !== undefined) row.theme = patch.theme;
      if (patch.highlightLabels !== undefined) row.highlight_labels = patch.highlightLabels;
      if (patch.readerPrefs !== undefined) row.reader_prefs = patch.readerPrefs;
      const { error } = await supabase.from("user_settings").upsert(row, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
    },
  };
}
