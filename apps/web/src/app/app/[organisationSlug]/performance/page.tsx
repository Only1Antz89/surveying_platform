import { operationsPage } from "@/lib/operations-page";
import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
export const metadata = { title: "Reports & insights" }; export const dynamic = "force-dynamic";
export default async function Page({ params }: PageProps<"/app/[organisationSlug]/performance">) {
  await requireWorkspacePageAccess((await params).organisationSlug, "performance");
  return operationsPage("performance", params);
}
