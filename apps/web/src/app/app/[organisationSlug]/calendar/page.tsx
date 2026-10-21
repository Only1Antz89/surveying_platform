import { operationsPage } from "@/lib/operations-page";
import { requireFirmAccess } from "@/lib/access";
import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import { ManagerCalendar } from "@/components/manager-calendar";

export const metadata = { title: "Calendar" }; export const dynamic = "force-dynamic";
export default async function Page({ params }: PageProps<"/app/[organisationSlug]/calendar">) {
  const { organisationSlug } = await params;
  await requireWorkspacePageAccess(organisationSlug, "calendar");
  const access = await requireFirmAccess(organisationSlug);

  // The manager mock-up uses illustrative sample data, so it is shown only in the demo workspace.
  if (access.userId === "demo_user") {
    return (
      <main className="page">
        <p className="address-demo-label">Demo workspace: sample data for illustration. Nothing here is saved.</p>
        <ManagerCalendar slug={organisationSlug} />
      </main>
    );
  }

  return operationsPage("calendar", params);
}

