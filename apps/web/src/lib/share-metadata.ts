import type { Metadata } from "next";

export const siteDescription = "Quotes, bookings, fieldwork and RICS reports in one workspace for surveying practices.";
export const siteTitle = "Surveynt · Survey intelligence, from site to report";

/** Social sharing tags for a public page; the sharing image comes from app/opengraph-image.tsx. */
export function shareMetadata(path: string, title = siteTitle, description = siteDescription): Pick<Metadata, "openGraph" | "twitter" | "alternates"> {
  return {
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: "Surveynt", locale: "en_GB", title, description, url: path },
    twitter: { card: "summary_large_image", title, description },
  };
}
