import { operationsPage } from "@/lib/operations-page";
import { requireFirmAccess } from "@/lib/access";
import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import { ManagerCalendar } from "@/components/manager-calendar";

export const metadata = { title: "Calendar" }; export const dynamic = "force-dynamic";
export default async function Page({ params }: PageProps<"/app/[organisationSlug]/calendar">) {
  const { organisationSlug } = await params;
  await requireWorkspacePageAccess(organisationSlug, "calendar");
  const access = await requireFirmAccess(organisationSlug);

  if (access.workspaceMode === "manager" || access.userId === "demo_user") {
    return (
      <main className="page">
        <ManagerCalendar slug={organisationSlug} />
      </main>
    );
  }

  return operationsPage("calendar", params);
}

