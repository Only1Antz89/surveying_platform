import {ConnectionsPanel} from "@/components/connections-panel";
import Link from "@/components/workspace-link";
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
import { SurveyRetentionSettings } from "@/components/survey-retention-settings";

import { canConfigureClientPayments } from "@/lib/integration-access";
export const metadata = { title: "Operations settings" }; export const dynamic = "force-dynamic";
export default async function Page({ params,searchParams }: PageProps<"/app/[organisationSlug]/settings/operations">) {
  const { organisationSlug } = await params; await requireWorkspacePageAccess(organisationSlug, "settings"); const access = await requireFirmAccess(organisationSlug);
  const saved = access.userId === "demo_user" ? null : await withTenant(createDatabase(), access.organisationId, (tx) => tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, access.organisationId)).limit(1).then((rows) => rows[0]));
  const initial = saved ?? { timezone: "Europe/London", officeAddress: null, workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"], workingHours: {}, holidayDates: [], customerBranding: {}, notificationPreferences: {}, bookingHorizonDays: 90, travelBufferMinutes: 30, mileageRatePence: 45, documentRetentionDays: 2555, publicQuotesEnabled: false, clientPaymentsEnabled: false };
  const view=(await searchParams).section; const sections=["office","hours","booking","notifications","public","report","retention","evidence","services","connections"];
  const section=typeof view==="string"&&sections.includes(view)?view:"office";
  const canEdit=access.accessLevel === "full" && isManagementRole(access.userRole);
  return <main className="page"><PageHeader title="Operations settings" description="Each section has its own settings and save action."/><div className="settings-grid"><nav className="settings-nav" aria-label="Operational settings">{sections.map(key=><Link key={key} className={key===section?"active":""} aria-current={key===section?"page":undefined} href={`/app/${organisationSlug}/settings/operations?section=${key}`}>{({office:"Office & routing",hours:"Hours & branding",booking:"Booking availability",notifications:"Notifications",public:"Public services",report:"Report identity",retention:"Retention",evidence:"Evidence release",services:"Service catalogue",connections:"Connections"} as Record<string,string>)[key]}</Link>)}</nav><div className="stack">{["office","hours","booking","notifications","public"].includes(section)?<OperationsSettingsForm key={section} section={section as "office"|"hours"|"booking"|"notifications"|"public"} initial={initial} canEdit={canEdit} canConfigurePayments={canConfigureClientPayments(access.userRole)}/>:null}{section==="report"?<ReportIdentitySettings canEdit={canEdit}/>:null}{section==="retention"?<SurveyRetentionSettings initial={saved?.surveyFileRetentionPolicy??null} canEdit={canEdit}/>:null}{section==="evidence"?<EvidenceReleaseSettings initial={saved?.surveyEvidenceEnabled??false} canEdit={canEdit&&access.userRole==="owner"&&access.isDemo}/>:null}{section==="services"?<ServiceCatalogue canEdit={canEdit}/>:null}{section==="connections"?<><ConnectionsPanel scope="practice"/><CapabilityPanel/></>:null}</div></div></main>;
}
