import { operationsPage } from "@/lib/operations-page";
import { requireFirmAccess } from "@/lib/access";
import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import { ManagerReports } from "@/components/manager-reports";

export const metadata = { title: "Reports & Insights" }; export const dynamic = "force-dynamic";
export default async function Page({ params }: PageProps<"/app/[organisationSlug]/performance">) {
  const { organisationSlug } = await params;
  await requireWorkspacePageAccess(organisationSlug, "performance");
  const access = await requireFirmAccess(organisationSlug);

  if (access.workspaceMode === "manager" || access.userId === "demo_user") {
    return (
      <main className="page">
        <ManagerReports slug={organisationSlug} />
      </main>
    );
  }

  return operationsPage("performance", params);
}

