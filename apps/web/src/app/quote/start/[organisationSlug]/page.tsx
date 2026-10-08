import { WebsiteFormEntry } from "@/components/website-form-entry";
export const metadata = { title: "Survey adviser" };
export default async function Page({ params }: PageProps<"/quote/start/[organisationSlug]">) { const { organisationSlug } = await params; return <WebsiteFormEntry slug={organisationSlug}/>; }
