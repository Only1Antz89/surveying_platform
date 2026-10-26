/**
 * The public origin used for canonical, sitemap and social-sharing URLs.
 * Set NEXT_PUBLIC_SITE_URL to the custom domain once one is connected.
 */
export function siteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const hostname = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return hostname ? `https://${hostname}` : "http://localhost:3000";
}
