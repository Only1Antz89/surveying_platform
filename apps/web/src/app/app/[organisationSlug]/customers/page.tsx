import { operationsPage } from "@/lib/operations-page";
export const metadata = { title: "Customers and quotes" }; export const dynamic = "force-dynamic";
export default async function Page({ params }: PageProps<"/app/[organisationSlug]/customers">) { return operationsPage("customers", params); }
