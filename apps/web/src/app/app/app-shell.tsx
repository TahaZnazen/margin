"use client";

import { clearLocalData, SyncProvider } from "@margin/sync/client";
import { Button } from "@margin/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@margin/ui/components/dropdown-menu";
import { cn } from "@margin/ui/lib/utils";
import { useTheme } from "@margin/ui/theme";
import {
  BookOpenIcon,
  DownloadIcon,
  LogOutIcon,
  NotebookPenIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { CommandPalette } from "@/components/command-palette";
import { SyncStatus } from "@/components/sync-status";
import { powersyncUrl } from "@/env";
import { palette } from "@/lib/commands/store";
import { services } from "@/lib/documents/services";
import { clearOfflinePages, PwaRegister, useCanInstall } from "@/lib/pwa/pwa";
import { createClient } from "@/lib/supabase/client";
import { UploadProvider } from "./upload-provider";

const NAV = [
  { href: "/app", label: "Library", Icon: BookOpenIcon },
  { href: "/app/notes", label: "Notes", Icon: NotebookPenIcon },
  { href: "/app/settings", label: "Settings", Icon: SettingsIcon },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/app"
    ? pathname === "/app" || pathname === "/app/library"
    : pathname.startsWith(href);
}

/** Pulls the saved theme into this browser (new device, cleared storage) once per shell mount. */
function useSettingsTheme() {
  const { preference, setPreference } = useTheme();
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount; later changes come from the settings page.
  useEffect(() => {
    let cancelled = false;
    services()
      .settings.get()
      .then((settings) => {
        // Skip if the user changed the theme while this request was in flight.
        const current = document.documentElement.getAttribute("data-theme-preference");
        if (!cancelled && current === preference && settings.theme !== preference) {
          setPreference(settings.theme);
        }
      })
      .catch(() => {
        // Offline or not yet saved: keep the local preference.
      });
    return () => {
      cancelled = true;
    };
  }, []);
}

export function AppShell({
  email,
  userId,
  children,
}: {
  email: string;
  userId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  useSettingsTheme();
  const { canInstall, install } = useCanInstall();

  async function signOut() {
    await clearLocalData().catch((error) => console.error("Could not clear local data", error));
    await clearOfflinePages();
    await createClient().auth.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <SyncProvider supabase={supabase} userId={userId} endpoint={powersyncUrl()}>
      <UploadProvider>
        <PwaRegister />
        <CommandPalette />
        <div className="flex min-h-dvh bg-background text-foreground">
          <nav
            aria-label="Main"
            className="hidden w-52 shrink-0 flex-col gap-1 border-r bg-card p-3 md:flex"
          >
            <p className="px-2 pt-1 pb-4 font-semibold font-serif text-xl">Margin</p>
            {NAV.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(pathname, href) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-muted",
                  isActive(pathname, href) && "bg-muted font-medium",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            ))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
              <p className="font-semibold font-serif text-lg md:invisible">Margin</p>
              <div className="flex items-center gap-1">
                <SyncStatus />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Command palette"
                  title="Command palette (Ctrl+K)"
                  data-testid="palette-button"
                  onClick={() => palette.open()}
                >
                  <SearchIcon />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Account menu">
                      <UserIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel data-testid="account-email">{email}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {canInstall ? (
                      <DropdownMenuItem onSelect={() => void install()}>
                        <DownloadIcon /> Install app
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onSelect={signOut}>
                      <LogOutIcon /> Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>
            <main className="flex-1 overflow-auto p-6 pb-20 md:pb-6">{children}</main>
          </div>

          <nav
            aria-label="Main (mobile)"
            className="fixed inset-x-0 bottom-0 z-10 flex border-t bg-card md:hidden"
          >
            {NAV.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(pathname, href) ? "page" : undefined}
                className={cn(
                  "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs",
                  isActive(pathname, href)
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </UploadProvider>
    </SyncProvider>
  );
}
