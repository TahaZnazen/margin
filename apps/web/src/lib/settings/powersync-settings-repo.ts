import { HIGHLIGHT_COLORS, type HighlightColor } from "@margin/annotation-model";
import { syncedForRead, syncUserId, writableDb } from "@margin/sync/client";
import { isThemePreference } from "@margin/ui/theme";
import {
  DEFAULT_READER_PREFS,
  ReaderPrefs,
  type Settings,
  type SettingsRepo,
} from "./settings-repo";

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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

type Row = { theme: string | null; highlight_labels: string | null; reader_prefs: string | null };

/**
 * `SettingsRepo` over the local PowerSync database. The row id is the user id: one settings row
 * per user (`unique (user_id)`), so two devices never create rival rows.
 */
export function createPowerSyncSettingsRepo(): SettingsRepo {
  return {
    async get() {
      const db = await syncedForRead();
      const row = await db.getOptional<Row>(
        "SELECT theme, highlight_labels, reader_prefs FROM user_settings WHERE deleted_at IS NULL LIMIT 1",
      );
      const prefs = ReaderPrefs.safeParse(parseJson(row?.reader_prefs));
      return {
        theme: isThemePreference(row?.theme) ? row.theme : "system",
        highlightLabels: parseLabels(parseJson(row?.highlight_labels)),
        readerPrefs: prefs.success ? prefs.data : DEFAULT_READER_PREFS,
      };
    },

    async save(patch) {
      const db = await writableDb();
      const userId = syncUserId();
      const now = new Date().toISOString();
      const sets: string[] = ["updated_at = ?"];
      const args: (string | null)[] = [now];
      if (patch.theme !== undefined) {
        sets.push("theme = ?");
        args.push(patch.theme);
      }
      if (patch.highlightLabels !== undefined) {
        sets.push("highlight_labels = ?");
        args.push(JSON.stringify(patch.highlightLabels));
      }
      if (patch.readerPrefs !== undefined) {
        sets.push("reader_prefs = ?");
        args.push(JSON.stringify(patch.readerPrefs));
      }
      await db.writeTransaction(async (tx) => {
        const exists = await tx.getOptional<{ id: string }>(
          "SELECT id FROM user_settings WHERE user_id = ?",
          [userId],
        );
        if (exists) {
          await tx.execute(
            `UPDATE user_settings SET ${sets.join(", ")}, deleted_at = NULL WHERE user_id = ?`,
            [...args, userId],
          );
          return;
        }
        await tx.execute(
          "INSERT INTO user_settings (id, user_id, theme, highlight_labels, reader_prefs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            userId,
            userId,
            patch.theme ?? "system",
            patch.highlightLabels === undefined ? null : JSON.stringify(patch.highlightLabels),
            patch.readerPrefs === undefined ? null : JSON.stringify(patch.readerPrefs),
            now,
            now,
          ],
        );
      });
    },
  };
}
