import { operationsPage } from "@/lib/operations-page";
export const metadata = { title: "Routes" }; export const dynamic = "force-dynamic";
export default async function Page({ params }: PageProps<"/app/[organisationSlug]/routes">) { return operationsPage("routes", params); }
