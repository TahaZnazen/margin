"use client";

import type * as React from "react";
import { Button } from "#components/button";
import { Kbd } from "#components/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "#components/tooltip";
import { cn } from "#lib/utils";

const SIZES = { sm: "icon-sm", default: "icon", lg: "icon-lg" } as const;

type IconButtonProps = Omit<React.ComponentProps<typeof Button>, "size" | "aria-label"> & {
  /** Accessible name, also shown as the tooltip. Required: an icon alone is not a label. */
  label: string;
  /** Keyboard shortcut shown in the tooltip, e.g. "T" or "⌘K". */
  shortcut?: string;
  size?: keyof typeof SIZES;
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"];
  /** Set false where a visible label sits next to the button already. */
  tooltip?: boolean;
};

/**
 * Icon-only button (Margin addition to shadcn/ui). Ghost by default so chrome stays quiet; on
 * touch screens the hit area grows to at least 44 px without changing the layout.
 */
function IconButton({
  label,
  shortcut,
  size = "default",
  variant = "ghost",
  tooltipSide,
  tooltip = true,
  className,
  ...props
}: IconButtonProps) {
  const button = (
    <Button
      data-slot="icon-button"
      aria-label={label}
      variant={variant}
      size={SIZES[size]}
      className={cn(
        "relative pointer-coarse:after:absolute pointer-coarse:after:-inset-2 pointer-coarse:after:content-['']",
        className,
      )}
      {...props}
    />
  );
  if (!tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side={tooltipSide}>
        {label}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export { IconButton, type IconButtonProps };
