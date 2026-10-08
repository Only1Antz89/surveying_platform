import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import Link from "@/components/workspace-link";
import { desc, eq } from "drizzle-orm";
import { createDatabase, jobs, withTenant } from "@surveynt/db";
import { canManageTeam, canMutateOperations } from "@surveynt/domain";
import { LearningContributions } from "@/components/learning-contributions";
import { PageHeader } from "@/components/page-header";
import { requireFirmAccess } from "@/lib/access";
import { loadLearningDashboard } from "@/lib/learning";
import { demoLearningDashboard } from "@/lib/learning-route";

export const metadata = { title: "Shared learning" };
export const dynamic = "force-dynamic";

export default async function LearningSettingsPage({ params }: PageProps<"/app/[organisationSlug]/settings/learning">) {
  const { organisationSlug } = await params; await requireWorkspacePageAccess(organisationSlug, "settings");
  const access = await requireFirmAccess(organisationSlug);
  const demo = access.userId === "demo_user";
  const [dashboard, jobOptions] = demo
    ? [demoLearningDashboard(), []]
    : await Promise.all([
      loadLearningDashboard(access),
      withTenant(createDatabase(), access.organisationId, (tx) => tx.select({ id: jobs.id, reference: jobs.reference }).from(jobs).where(eq(jobs.organisationId, access.organisationId)).orderBy(desc(jobs.createdAt)).limit(200)),
    ]);
  const full = access.accessLevel === "full";
  return <main className="page">
    <PageHeader title="Shared learning" description="Choose whether reviewed, generalised cases from your signed-off surveys may improve assistance for every firm. Off by default." />
    <div className="settings-grid">
      <nav className="settings-nav" aria-label="Settings"><Link href={`/app/${organisationSlug}/settings`}>Practice details</Link><Link href={`/app/${organisationSlug}/settings/billing`}>Billing</Link><Link href={`/app/${organisationSlug}/settings/ai`}>AI and assistant</Link><Link className="active" href={`/app/${organisationSlug}/settings/learning`}>Shared learning</Link><Link href={`/app/${organisationSlug}/team`}>Security</Link></nav>
      <LearningContributions initial={dashboard} jobs={jobOptions} canManage={full && canManageTeam(access.userRole)} canWithdraw={full && canMutateOperations(access.userRole)} demo={demo} />
    </div>
  </main>;
}
