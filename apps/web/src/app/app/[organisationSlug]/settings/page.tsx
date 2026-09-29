import Link from "next/link";
import { canManageTeam } from "@fieldnote/domain";
import { PageHeader } from "@/components/page-header";
import { PracticeSettingsForm } from "@/components/practice-settings-form";
import { requireFirmAccess } from "@/lib/access";
import { loadOrganisationSettings } from "@/lib/data";

export const metadata = { title: "Settings" };
export default async function SettingsPage({ params }: { params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params;
  const [settings, access] = await Promise.all([loadOrganisationSettings(organisationSlug), requireFirmAccess(organisationSlug)]);
  return <main className="page"><PageHeader title="Practice settings" description="Manage the details clients see and the defaults your team uses." /><div className="settings-grid"><nav className="settings-nav" aria-label="Settings"><Link className="active" href={`/app/${organisationSlug}/settings`}>Practice details</Link><Link href={`/app/${organisationSlug}/settings/billing`}>Billing</Link><Link href={`/app/${organisationSlug}/team`}>Security</Link></nav><PracticeSettingsForm initial={settings} canEdit={canManageTeam(access.userRole)} /></div></main>;
}
