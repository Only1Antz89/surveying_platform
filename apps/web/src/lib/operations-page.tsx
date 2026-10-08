import { FirmOperationsView } from "@/components/firm-operations-view";
import { requireFirmAccess } from "@/lib/access";
import { listFirmOperations } from "@/lib/firm-operations";
import { isManagementRole,canMutateOperations,canManageFinance } from "@surveynt/domain";
import { notFound } from "next/navigation";

export type OperationsSection = "calendar" | "customers" | "routes" | "finance" | "performance" | "report-templates" | "documents";
export async function operationsPage(section: OperationsSection, params: Promise<{ organisationSlug: string }>) {
  const { organisationSlug } = await params;
  const access = await requireFirmAccess(organisationSlug);
  if (access.userRole === "finance" && section !== "finance") notFound();
  if (access.userRole === "surveyor" && section === "customers") notFound();
  if((section==="finance"||section==="performance")&&!isManagementRole(access.userRole)&&(section!=="finance"||access.userRole!=="finance"))notFound();
  const data = access.userId === "demo_user" ? { quotes: [], appointments: [], finance: [], documents: [], totals:{quotes:0,converted:0,receipts:0,outstanding:0,invoices:0,currencies:[]} } : await listFirmOperations(access.organisationId, { role: access.userRole, userId: access.internalUserId });
  return <FirmOperationsView section={section} slug={organisationSlug} data={data} canEdit={access.accessLevel==="full"&&canMutateOperations(access.userRole)} canManage={access.accessLevel==="full"&&(section === "finance" ? canManageFinance(access.userRole) : isManagementRole(access.userRole))} />;
}
