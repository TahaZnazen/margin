import type { MetadataRoute } from "next";

// Colors are the "Calm paper" tokens (packages/ui/src/styles/tokens.css): --bg and --accent.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Margin",
    short_name: "Margin",
    description: "Read it once. Remember it.",
    id: "/app",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#f7f5f0",
    theme_color: "#2c5f5a",
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
