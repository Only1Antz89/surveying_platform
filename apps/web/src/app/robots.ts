import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

// Only the public sign-in, sign-up and enquiry pages may be indexed. Workspaces, quote links
// (which carry access tokens), embeds and APIs are excluded.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/", "/quote/start/"], disallow: ["/app/", "/platform/", "/api/", "/account", "/start", "/trial/", "/quote/", "/portal/", "/embed/", "/website-form-preview/"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
