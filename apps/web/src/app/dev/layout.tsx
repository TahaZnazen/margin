import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { devRoutesEnabled } from "@/config/dev-routes";
import { DirectionSync } from "./_components/direction";
import { directionScript } from "./_components/direction-script";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DevLayout({ children }: LayoutProps<"/dev">) {
  if (!devRoutesEnabled()) notFound();
  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static dev-only script, no user input. */}
      <script dangerouslySetInnerHTML={{ __html: directionScript }} />
      <DirectionSync />
      {children}
    </>
  );
}
