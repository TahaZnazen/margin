import {
  DEFAULT_PREFERENCE,
  isThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  THEMES,
  type Theme,
  type ThemePreference,
} from "./themes";

/** Browser-side theme state: localStorage + the OS color scheme, applied to <html>. */

const CHANGE_EVENT = "margin:themechange";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_PREFERENCE;
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

export function currentTheme(): Theme {
  return resolveTheme(readPreference(), systemPrefersDark());
}

/** Puts the resolved theme class on <html>. Idempotent. */
export function applyTheme(): void {
  const root = document.documentElement;
  const preference = readPreference();
  const theme = resolveTheme(preference, systemPrefersDark());
  for (const t of THEMES) if (t !== theme) root.classList.remove(t);
  root.classList.add(theme);
  root.setAttribute("data-theme-preference", preference);
}

export function setPreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Private mode or blocked storage: the theme still applies for this page view.
  }
  applyTheme();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Subscribes to every source of change: this tab, other tabs, and the OS setting. */
export function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", onChange);
  };
}
