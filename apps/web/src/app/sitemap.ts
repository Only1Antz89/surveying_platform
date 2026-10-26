import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

// Workspaces, quotes, portals and embeds are private, so only the public entry pages are listed.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    { url: `${base}/sign-in`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/sign-up`, changeFrequency: "monthly", priority: 1 },
  ];
}
