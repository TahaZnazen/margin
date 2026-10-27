import { themeScript } from "./themes";

/**
 * Render inside <head> of the root layout, and put `suppressHydrationWarning` on <html>:
 * the script adds the theme class before React hydrates.
 */
export function ThemeScript() {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: static script built from constants, no user input.
  return <script dangerouslySetInnerHTML={{ __html: themeScript() }} />;
}
