import type { Metadata } from "next";
import { shareMetadata } from "@/lib/share-metadata";
import { WebsiteFormEntry } from "@/components/website-form-entry";
export async function generateMetadata({ params }: PageProps<"/quote/start/[organisationSlug]">): Promise<Metadata> {
  const { organisationSlug } = await params;
  const description = "Answer a few questions about the property to find the right survey and request a quote.";
  return { title: "Survey adviser", description, ...shareMetadata(`/quote/start/${organisationSlug}`, "Survey adviser", description) };
}
export default async function Page({ params }: PageProps<"/quote/start/[organisationSlug]">) { const { organisationSlug } = await params; return <WebsiteFormEntry slug={organisationSlug}/>; }
