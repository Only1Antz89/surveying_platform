import { operationsPage } from "@/lib/operations-page";
export const metadata = { title: "Calendar" }; export const dynamic = "force-dynamic";
export default async function Page({ params }: PageProps<"/app/[organisationSlug]/calendar">) { return operationsPage("calendar", params); }
