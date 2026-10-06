import { WebsiteFormEntry } from "@/components/website-form-entry";
export const metadata = { title: "Survey enquiry", robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ organisationSlug: string }> }) { return <WebsiteFormEntry slug={(await params).organisationSlug}/>; }
