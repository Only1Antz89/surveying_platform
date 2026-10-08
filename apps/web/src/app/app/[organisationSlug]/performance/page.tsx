import { operationsPage } from "@/lib/operations-page";
export const metadata = { title: "Performance" }; export const dynamic = "force-dynamic";
export default async function Page({ params }: PageProps<"/app/[organisationSlug]/performance">) { return operationsPage("performance", params); }
