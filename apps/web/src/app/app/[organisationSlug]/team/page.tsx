import { canManageTeam } from "@surveynt/domain";
import { PageHeader } from "@/components/page-header";
import { SupportApprovalPanel } from "@/components/support-approval-panel";
import { TeamManager } from "@/components/team-manager";
import { requireFirmAccess } from "@/lib/access";
import { loadMembers, loadPendingSupportRequests } from "@/lib/data";

export const metadata = { title: "Team" };

export default async function TeamPage({ params }: { params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params;
  const [members, access, supportRequests] = await Promise.all([loadMembers(organisationSlug), requireFirmAccess(organisationSlug), loadPendingSupportRequests(organisationSlug)]);
  return <main className="page">
    <PageHeader title="Team" description="Control practice access, professional roles and current workload." />
    <TeamManager members={members} canManage={canManageTeam(access.userRole) && access.accessLevel === "full"} actorRole={access.userRole} />
    {access.userRole === "owner" ? <SupportApprovalPanel initialRequests={supportRequests} /> : null}
  </main>;
}
