import type { MetadataRoute } from "next";

// Installable on a phone's home screen (the page itself needs the network: there is no offline mode).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Home AC",
    short_name: "Home AC",
    description: "Local control for Mitsubishi Heavy air conditioners",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f6f1",
    theme_color: "#007374",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
