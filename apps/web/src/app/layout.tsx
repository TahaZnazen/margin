import { Toaster } from "@margin/ui/components/sonner";
import { TooltipProvider } from "@margin/ui/components/tooltip";
import { ThemeScript, ThemeSync } from "@margin/ui/theme";
import type { Metadata, Viewport } from "next";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Margin",
  description: "Read it once. Remember it.",
  applicationName: "Margin",
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Margin", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#2c5f5a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The theme script adds the theme class before hydration, hence suppressHydrationWarning.
    <html lang="en" className={`h-full ${fontVariables}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="flex min-h-full flex-col">
        <ThemeSync />
        <TooltipProvider delayDuration={400}>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
