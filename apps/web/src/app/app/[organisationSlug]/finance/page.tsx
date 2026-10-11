import { operationsPage } from "@/lib/operations-page";
import { requireFirmAccess } from "@/lib/access";
import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import { ManagerFinance } from "@/components/manager-finance";

export const metadata = { title: "Finance" }; export const dynamic = "force-dynamic";
export default async function Page({ params }: PageProps<"/app/[organisationSlug]/finance">) {
  const { organisationSlug } = await params;
  await requireWorkspacePageAccess(organisationSlug, "finance");
  const access = await requireFirmAccess(organisationSlug);

  if (access.workspaceMode === "manager" || access.userId === "demo_user") {
    return (
      <main className="page">
        <ManagerFinance slug={organisationSlug} />
      </main>
    );
  }

  return operationsPage("finance", params);
}

