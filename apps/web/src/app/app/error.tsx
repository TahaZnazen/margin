"use client";

import { Button } from "@margin/ui/components/button";

/** A screen inside /app threw: say so, keep the shell, and offer a retry. Local data is untouched. */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div
      className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center"
      role="alert"
      data-testid="app-error"
    >
      <h1 className="font-serif text-xl">Something went wrong</h1>
      <p className="text-muted-foreground text-sm">
        This screen could not load. Your books, highlights and notes are safe on this device.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
