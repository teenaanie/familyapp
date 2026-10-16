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
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
