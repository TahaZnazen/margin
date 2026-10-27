"use client";

// TEMPORARY (P03 step 1): switches between the two candidate design directions on /dev pages.
// Delete this file, direction-script.ts and the [data-direction] blocks in tokens.css once the
// user has picked.

import { ToggleGroup, ToggleGroupItem } from "@margin/ui/components/toggle-group";
import { useLayoutEffect, useState } from "react";
import { DIRECTION_KEY, DIRECTIONS, type Direction } from "./direction-script";

function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && (DIRECTIONS as readonly string[]).includes(value);
}

function readDirection(): Direction {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("direction");
    if (isDirection(fromUrl)) return fromUrl;
    const stored = window.localStorage.getItem(DIRECTION_KEY);
    if (isDirection(stored)) return stored;
  } catch {}
  return "paper";
}

function apply(direction: Direction) {
  document.documentElement.setAttribute("data-direction", direction);
}

/** Re-applies after React resets <html> attributes; clears when leaving /dev. */
export function DirectionSync() {
  useLayoutEffect(() => {
    apply(readDirection());
    return () => document.documentElement.removeAttribute("data-direction");
  }, []);
  return null;
}

export function DirectionSwitch() {
  const [direction, setDirection] = useState<Direction>("paper");
  useLayoutEffect(() => setDirection(readDirection()), []);
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={direction}
      aria-label="Design direction"
      onValueChange={(value) => {
        if (!isDirection(value)) return;
        setDirection(value);
        apply(value);
        try {
          window.localStorage.setItem(DIRECTION_KEY, value);
          const url = new URL(window.location.href);
          url.searchParams.set("direction", value);
          window.history.replaceState(null, "", url);
        } catch {}
      }}
    >
      {DIRECTIONS.map((d) => (
        <ToggleGroupItem key={d} value={d} className="capitalize">
          {d}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
