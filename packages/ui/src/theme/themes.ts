/**
 * Reader themes. The resolved theme is a class on <html> (`light`, `sepia` or `dark`), set by an
 * inline script before first paint (see `themeScript`) and kept in sync by `<ThemeSync />`.
 */

export const THEMES = ["light", "sepia", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_PREFERENCES = ["system", ...THEMES] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const THEME_STORAGE_KEY = "margin:theme";
export const DEFAULT_PREFERENCE: ThemePreference = "system";

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** "system" follows the OS light/dark setting; sepia is only ever chosen explicitly. */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): Theme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/**
 * Inline script for <head>. Runs synchronously during HTML parsing, so the right theme class is
 * on <html> before anything paints. Self-contained ES5; any failure falls back to light.
 */
export function themeScript(): string {
  const themes = JSON.stringify(THEMES);
  const prefs = JSON.stringify(THEME_PREFERENCES);
  return `(function(){var d=document.documentElement;try{var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(${prefs}.indexOf(p)<0)p=${JSON.stringify(DEFAULT_PREFERENCE)};var t=p==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;d.classList.remove.apply(d.classList,${themes});d.classList.add(t);d.setAttribute("data-theme-preference",p)}catch(e){d.classList.add("light")}})()`;
}
