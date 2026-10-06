import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import { isManagementRole } from "@surveynt/domain";
import { createDatabase, organisationOperationalSettings, withTenant } from "@surveynt/db";
import { eq } from "drizzle-orm";
import { OperationsSettingsForm } from "@/components/operations-settings-form";
import { PageHeader } from "@/components/page-header";
import { requireFirmAccess } from "@/lib/access";
import { CapabilityPanel } from "@/components/capability-panel";
import { ServiceCatalogue } from "@/components/service-catalogue";
import { EvidenceReleaseSettings } from "@/components/evidence-release-settings";
import { ReportIdentitySettings } from "@/components/report-identity-settings";

import { canConfigureClientPayments } from "@/lib/integration-access";
export const metadata = { title: "Operations settings" }; export const dynamic = "force-dynamic";
export default async function Page({ params }: PageProps<"/app/[organisationSlug]/settings/operations">) {
  const { organisationSlug } = await params; await requireWorkspacePageAccess(organisationSlug, "settings"); const access = await requireFirmAccess(organisationSlug);
  const saved = access.userId === "demo_user" ? null : await withTenant(createDatabase(), access.organisationId, (tx) => tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, access.organisationId)).limit(1).then((rows) => rows[0]));
  const initial = saved ?? { timezone: "Europe/London", officeAddress: null, workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"], workingHours: {}, holidayDates: [], customerBranding: {}, notificationPreferences: {}, bookingHorizonDays: 90, travelBufferMinutes: 30, mileageRatePence: 45, documentRetentionDays: 2555, publicQuotesEnabled: false, clientPaymentsEnabled: false };
  const canEdit=access.accessLevel === "full" && isManagementRole(access.userRole);
  return <main className="page"><PageHeader title="Operations settings" description="Control availability, routing, retention, public quotes and client payments." /><OperationsSettingsForm initial={initial} canEdit={canEdit} canConfigurePayments={canConfigureClientPayments(access.userRole)}/><ReportIdentitySettings canEdit={canEdit}/><EvidenceReleaseSettings initial={saved?.surveyEvidenceEnabled ?? false} canEdit={canEdit && access.userRole === "owner" && access.isDemo}/><ServiceCatalogue canEdit={canEdit}/>{canConfigureClientPayments(access.userRole)?<CapabilityPanel scope="payments"/>:null}</main>;
}
