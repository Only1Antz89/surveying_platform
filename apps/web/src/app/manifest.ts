import type { MetadataRoute } from "next";

// Lets surveyors install Surveynt on a phone or tablet; offline capture is provided by /sw.js.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Surveynt",
    short_name: "Surveynt",
    description: "Survey intelligence, from site to report.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3f6fb",
    theme_color: "#2563eb",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
