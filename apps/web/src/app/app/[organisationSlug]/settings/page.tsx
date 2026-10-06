import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import Link from "next/link";
import { isManagementRole } from "@surveynt/domain";
import { PageHeader } from "@/components/page-header";
import { PracticeSettingsForm } from "@/components/practice-settings-form";
import { requireFirmAccess } from "@/lib/access";
import { loadOrganisationSettings } from "@/lib/data";

export const metadata = { title: "Settings" };
export default async function SettingsPage({ params }: { params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params; await requireWorkspacePageAccess(organisationSlug, "settings");
  const [settings, access] = await Promise.all([loadOrganisationSettings(organisationSlug), requireFirmAccess(organisationSlug)]);
  return <main className="page"><PageHeader title="Practice settings" description="Manage the details clients see and the defaults your team uses." /><div className="settings-grid"><nav className="settings-nav" aria-label="Settings"><Link className="active" href={`/app/${organisationSlug}/settings`}>Practice details</Link><Link href={`/app/${organisationSlug}/settings/operations`}>Operations</Link>{access.userRole === "owner" ? <Link href={`/app/${organisationSlug}/settings/billing`}>Billing</Link> : null}<Link href={`/app/${organisationSlug}/settings/ai`}>AI and assistant</Link><Link href={`/app/${organisationSlug}/settings/learning`}>Shared learning</Link>{["owner", "administrator"].includes(access.userRole) ? <Link href={`/app/${organisationSlug}/team`}>Team and permissions</Link> : null}</nav><PracticeSettingsForm initial={settings} canEdit={isManagementRole(access.userRole)} /></div></main>;
}
