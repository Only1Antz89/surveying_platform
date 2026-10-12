import { operationsPage } from "@/lib/operations-page";
import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
export const metadata = { title: "Finance" }; export const dynamic = "force-dynamic";
export default async function Page({ params }: PageProps<"/app/[organisationSlug]/finance">) {
  await requireWorkspacePageAccess((await params).organisationSlug, "finance");
  return operationsPage("finance", params);
}
