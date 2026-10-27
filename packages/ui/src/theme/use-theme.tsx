"use client";

import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import { applyTheme, currentTheme, readPreference, setPreference, subscribe } from "./store";
import { DEFAULT_PREFERENCE, type Theme, type ThemePreference } from "./themes";

const serverPreference = (): ThemePreference => DEFAULT_PREFERENCE;
const serverTheme = (): Theme => "light";

/**
 * The user's theme preference and the theme it resolves to. On the server and during hydration
 * this reports the defaults; the page itself is already painted correctly by the theme script.
 */
export function useTheme() {
  const preference = useSyncExternalStore(subscribe, readPreference, serverPreference);
  const theme = useSyncExternalStore(subscribe, currentTheme, serverTheme);
  const set = useCallback((next: ThemePreference) => setPreference(next), []);
  return { preference, theme, setPreference: set };
}

/**
 * Mount once in the root layout. Re-applies the theme class after React resets <html>
 * attributes (dev Strict Mode remount) and follows OS and cross-tab changes.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyTheme();
    return subscribe(applyTheme);
  }, []);
  return null;
}
