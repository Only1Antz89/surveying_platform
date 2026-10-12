import type { MetadataRoute } from "next";

// Only the public marketing and enquiry pages may be indexed. Workspaces, quote links
// (which carry access tokens), embeds and APIs are excluded.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/", "/quote/start/"], disallow: ["/app/", "/platform/", "/api/", "/account", "/start", "/trial/", "/quote/", "/embed/", "/website-form-preview/", "/sign-in", "/sign-up"] },
  };
}
