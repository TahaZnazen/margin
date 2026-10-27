"use client";

import { CoffeeIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "#components/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "#components/tooltip";
import { isThemePreference, type ThemePreference } from "../theme/themes";
import { useTheme } from "../theme/use-theme";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof SunIcon }[] = [
  { value: "system", label: "System", Icon: MonitorIcon },
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "sepia", label: "Sepia", Icon: CoffeeIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
];

/** Theme picker (Margin addition): system, light, sepia, dark. Icons with tooltips. */
function ThemeSwitch({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={preference}
      aria-label="Theme"
      className={className}
      onValueChange={(value) => {
        if (isThemePreference(value)) setPreference(value);
      }}
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <Tooltip key={value}>
          <TooltipTrigger asChild>
            <ToggleGroupItem value={value} aria-label={label}>
              <Icon />
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}

export { ThemeSwitch };
