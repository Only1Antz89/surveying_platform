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
  const access = await requireFirmAccess(organisationSlug);
  const isManager = access.workspaceMode === "manager" || access.userRole === "manager";

  // The manager mock-up uses illustrative sample data, so it is shown only in the demo workspace.
  if (access.userId === "demo_user" && isManager) {
    return (
      <main className="page">
        <p className="address-demo-label">Demo workspace: sample data for illustration. Nothing here is saved.</p>
        <ManagerStaff slug={organisationSlug} />
      </main>
    );
  }

  const [members,supportRequests]=await Promise.all([loadMembers(organisationSlug),loadPendingSupportRequests(organisationSlug)]);

  return <main className="page">
    <PageHeader
      title={isManager ? "Surveyors" : "Surveyors & staff"}
      description={isManager ? "Surveyors in this practice and their current workload." : "Control practice access, professional roles and current workload."}
    />
    <TeamManager slug={organisationSlug} members={isManager ? members.filter((member) => member.role === "surveyor") : members} canManage={canManageTeam(access.userRole) && access.accessLevel === "full"} actorRole={access.userRole} isManager={isManager} />
    {access.userRole === "owner" && access.accessLevel === "full" ? <ProfessionalPermissions members={members} /> : null}
    {access.userRole === "owner" ? <SupportApprovalPanel organisationSlug={organisationSlug} initialRequests={supportRequests} /> : null}
  </main>;
}
