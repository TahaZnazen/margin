"use client";

import { DEFAULT_HIGHLIGHT_LABELS, HIGHLIGHT_COLORS } from "@margin/annotation-model";
import { Button } from "@margin/ui/components/button";
import { Input } from "@margin/ui/components/input";
import { toast } from "@margin/ui/components/sonner";
import { ThemeSwitch } from "@margin/ui/components/theme-switch";
import { ToggleGroup, ToggleGroupItem } from "@margin/ui/components/toggle-group";
import { useTheme } from "@margin/ui/theme";
import { useEffect, useRef, useState } from "react";
import { services } from "@/lib/documents/services";
import type { Settings } from "@/lib/settings/settings-repo";

// Created on use, never during render: the browser client must not start a session on the server.
const getRepo = () => services().settings;

export function SettingsForm() {
  const { preference } = useTheme();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    getRepo()
      .get()
      .then((loaded) => {
        setSettings(loaded);
        setLabels({ ...DEFAULT_HIGHLIGHT_LABELS, ...loaded.highlightLabels });
      })
      .catch(() => toast.error("Couldn't load your settings."));
  }, []);

  // The theme control changes the local preference (instant, no flash); save every later change.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    getRepo()
      .save({ theme: preference })
      .catch(() => toast.error("Couldn't save the theme."));
  }, [preference]);

  async function saveLabels() {
    const custom: Settings["highlightLabels"] = {};
    for (const color of HIGHLIGHT_COLORS) {
      const value = (labels[color] ?? "").trim();
      if (value && value !== DEFAULT_HIGHLIGHT_LABELS[color]) custom[color] = value;
    }
    try {
      await getRepo().save({ highlightLabels: custom });
      toast.success("Labels saved.");
    } catch {
      toast.error("Couldn't save the labels.");
    }
  }

  async function saveZoom(value: string) {
    if (!settings || (value !== "fit-width" && value !== "fit-page")) return;
    const readerPrefs: Settings["readerPrefs"] = { ...settings.readerPrefs, defaultZoom: value };
    setSettings({ ...settings, readerPrefs });
    try {
      await getRepo().save({ readerPrefs });
    } catch {
      toast.error("Couldn't save the zoom.");
    }
  }

  async function saveAutoMark(checked: boolean) {
    if (!settings) return;
    const readerPrefs: Settings["readerPrefs"] = {
      ...settings.readerPrefs,
      autoMarkChapters: checked,
    };
    setSettings({ ...settings, readerPrefs });
    try {
      await getRepo().save({ readerPrefs });
    } catch {
      toast.error("Couldn't save the setting.");
    }
  }

  return (
    <div className="space-y-8">
      <fieldset className="space-y-2">
        <legend className="font-medium text-sm">Theme</legend>
        <ThemeSwitch />
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-medium text-sm">Default zoom</legend>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Default zoom"
          value={settings?.readerPrefs.defaultZoom ?? ""}
          onValueChange={saveZoom}
          className="w-fit"
        >
          <ToggleGroupItem value="fit-width">Fit width</ToggleGroupItem>
          <ToggleGroupItem value="fit-page">Fit page</ToggleGroupItem>
        </ToggleGroup>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-medium text-sm">Chapters</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="auto-mark-chapters"
            className="size-4 accent-primary"
            disabled={!settings}
            checked={settings?.readerPrefs.autoMarkChapters === true}
            onChange={(event) => void saveAutoMark(event.target.checked)}
          />
          Mark chapters done when I finish their last page
        </label>
      </fieldset>

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void saveLabels();
        }}
      >
        <p className="font-medium text-sm">Highlight labels</p>
        {HIGHLIGHT_COLORS.map((color) => (
          <div key={color} className="flex items-center gap-3">
            <label
              htmlFor={`label-${color}`}
              className="flex w-36 shrink-0 items-center gap-2 text-muted-foreground text-sm"
            >
              <span
                aria-hidden="true"
                data-testid="label-swatch"
                className="size-3.5 shrink-0 rounded-full"
                style={{ background: `var(--hl-${color}-chip)` }}
              />
              {DEFAULT_HIGHLIGHT_LABELS[color]}
            </label>
            <Input
              id={`label-${color}`}
              value={labels[color] ?? ""}
              placeholder={DEFAULT_HIGHLIGHT_LABELS[color]}
              disabled={!settings}
              maxLength={40}
              onChange={(event) => setLabels({ ...labels, [color]: event.target.value })}
            />
          </div>
        ))}
        <Button type="submit" disabled={!settings}>
          Save labels
        </Button>
      </form>
    </div>
  );
}
