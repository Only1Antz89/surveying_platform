import Link from "next/link";
import { canManageTeam } from "@surveynt/domain";
import { createDatabase, organisationOperationalSettings, withTenant } from "@surveynt/db";
import { eq } from "drizzle-orm";
import { OperationsSettingsForm } from "@/components/operations-settings-form";
import { PageHeader } from "@/components/page-header";
import { requireFirmAccess } from "@/lib/access";

export const metadata = { title: "Operations settings" }; export const dynamic = "force-dynamic";
export default async function Page({ params }: PageProps<"/app/[organisationSlug]/settings/operations">) {
  const { organisationSlug } = await params; const access = await requireFirmAccess(organisationSlug);
  const saved = access.userId === "demo_user" ? null : await withTenant(createDatabase(), access.organisationId, (tx) => tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, access.organisationId)).limit(1).then((rows) => rows[0]));
  const initial = saved ?? { timezone: "Europe/London", officeAddress: null, workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"], workingHours: {}, holidayDates: [], customerBranding: {}, notificationPreferences: {}, bookingHorizonDays: 90, travelBufferMinutes: 30, mileageRatePence: 45, documentRetentionDays: 2555, publicQuotesEnabled: false, clientPaymentsEnabled: false };
  return <main className="page"><PageHeader title="Operations settings" description="Control availability, routing, retention, public quotes and client payments." /><div className="settings-grid"><nav className="settings-nav" aria-label="Settings"><Link href={`/app/${organisationSlug}/settings`}>Practice details</Link><Link className="active" href={`/app/${organisationSlug}/settings/operations`}>Operations</Link><Link href={`/app/${organisationSlug}/settings/billing`}>Subscription billing</Link><Link href={`/app/${organisationSlug}/team`}>Security</Link></nav><OperationsSettingsForm initial={initial} canEdit={access.accessLevel === "full" && canManageTeam(access.userRole)} /></div></main>;
}
