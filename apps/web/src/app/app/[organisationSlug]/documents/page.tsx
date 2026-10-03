import { operationsPage } from "@/lib/operations-page";
export const metadata = { title: "Documents" }; export const dynamic = "force-dynamic";
export default async function Page({ params }: PageProps<"/app/[organisationSlug]/documents">) { return operationsPage("documents", params); }
