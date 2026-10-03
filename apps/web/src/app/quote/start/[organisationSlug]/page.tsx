import { PublicQuoteAdviser } from "@/components/public-quote-adviser";
export const metadata = { title: "Survey adviser" };
export default async function Page({ params }: PageProps<"/quote/start/[organisationSlug]">) { const { organisationSlug } = await params; return <PublicQuoteAdviser organisationSlug={organisationSlug} />; }
