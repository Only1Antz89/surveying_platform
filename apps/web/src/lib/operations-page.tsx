import { FirmOperationsView } from "@/components/firm-operations-view";
import { requireFirmAccess } from "@/lib/access";
import { listFirmOperations } from "@/lib/firm-operations";

export type OperationsSection = "calendar" | "customers" | "routes" | "finance" | "performance" | "report-templates" | "documents";
export async function operationsPage(section: OperationsSection, params: Promise<{ organisationSlug: string }>) {
  const { organisationSlug } = await params;
  const access = await requireFirmAccess(organisationSlug);
  const data = access.userId === "demo_user" ? { quotes: [], appointments: [], finance: [], documents: [] } : await listFirmOperations(access.organisationId);
  return <FirmOperationsView section={section} slug={organisationSlug} data={data} />;
}
