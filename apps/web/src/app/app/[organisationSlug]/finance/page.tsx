import { operationsPage } from "@/lib/operations-page";
export const metadata = { title: "Finance" }; export const dynamic = "force-dynamic";
export default async function Page({ params }: PageProps<"/app/[organisationSlug]/finance">) { return operationsPage("finance", params); }
