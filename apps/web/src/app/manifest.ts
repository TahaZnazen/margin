import { brandColors } from "@margin/ui/brand-colors";
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Anagnosis",
    short_name: "Anagnosis",
    description: "Read it once. Remember it.",
    id: "/app",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: brandColors.background,
    theme_color: brandColors.accent,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
