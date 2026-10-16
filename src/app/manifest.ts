import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Family Helper",
    short_name: "Family",
    description: "Reminders, vegetable bills, staff attendance and monthly payments",
    start_url: "/",
    display: "standalone",
    background_color: "#fdf7ee",
    theme_color: "#fdf7ee",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
