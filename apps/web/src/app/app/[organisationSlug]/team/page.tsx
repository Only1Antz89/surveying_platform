import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import { canManageTeam } from "@surveynt/domain";
import { PageHeader } from "@/components/page-header";
import { SupportApprovalPanel } from "@/components/support-approval-panel";
import { TeamManager } from "@/components/team-manager";
import { ProfessionalPermissions } from "@/components/professional-permissions";
import { requireFirmAccess } from "@/lib/access";
import { loadMembers, loadPendingSupportRequests } from "@/lib/data";
import { ManagerStaff } from "@/components/manager-staff";

export async function generateMetadata({ params }: { params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params;
  const access = await requireFirmAccess(organisationSlug);
  const isManager = access.workspaceMode === "manager" || access.userRole === "manager";
  return { title: isManager ? "Surveyors" : "Team" };
}

export default async function TeamPage({ params }: { params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params; await requireWorkspacePageAccess(organisationSlug, "team");
  const [members, access, supportRequests] = await Promise.all([loadMembers(organisationSlug), requireFirmAccess(organisationSlug), loadPendingSupportRequests(organisationSlug)]);
  const isManager = access.workspaceMode === "manager" || access.userRole === "manager";

  if (isManager) {
    return (
      <main className="page">
        <ManagerStaff slug={organisationSlug} />
      </main>
    );
  }

  return <main className="page">
    <PageHeader
      title="Surveyors & staff"
      description="Control practice access, professional roles and current workload."
    />
    <TeamManager slug={organisationSlug} members={members} canManage={canManageTeam(access.userRole) && access.accessLevel === "full"} actorRole={access.userRole} isManager={false} />
    {access.userRole === "owner" && access.accessLevel === "full" ? <ProfessionalPermissions members={members} /> : null}
    {access.userRole === "owner" ? <SupportApprovalPanel organisationSlug={organisationSlug} initialRequests={supportRequests} /> : null}
  </main>;
}
