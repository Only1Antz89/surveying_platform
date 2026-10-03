import { operationsPage } from "@/lib/operations-page";
export const metadata = { title: "Report templates" }; export const dynamic = "force-dynamic";
export default async function Page({ params }: PageProps<"/app/[organisationSlug]/report-templates">) { return operationsPage("report-templates", params); }
