"use client";

import { useEffect, useState } from "react";

/**
 * Reads a CSS custom property from an element (default <html>) and re-reads it whenever the
 * theme or direction attributes on <html> change.
 */
export function useCssVars(names: readonly string[], target?: () => Element | null): string[] {
  const [values, setValues] = useState<string[]>(() => names.map(() => ""));
  const key = names.join("|");

  useEffect(() => {
    const list = key.split("|");
    const read = () => {
      const el = target?.() ?? document.documentElement;
      const style = getComputedStyle(el);
      setValues(list.map((n) => style.getPropertyValue(n).trim()));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, [key, target]);

  return values;
}
