import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import { canManageTeam } from "@surveynt/domain";
import { PageHeader } from "@/components/page-header";
import { SupportApprovalPanel } from "@/components/support-approval-panel";
import { TeamManager } from "@/components/team-manager";
import { ProfessionalPermissions } from "@/components/professional-permissions";
import { notFound } from "next/navigation";
import { requireFirmAccess } from "@/lib/access";
import { loadMembers, loadPendingSupportRequests } from "@/lib/data";

export const metadata = { title: "Team" };

export default async function TeamPage({ params }: { params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params; await requireWorkspacePageAccess(organisationSlug, "team");
  const [members, access, supportRequests] = await Promise.all([loadMembers(organisationSlug), requireFirmAccess(organisationSlug), loadPendingSupportRequests(organisationSlug)]);
  if (!canManageTeam(access.userRole)) notFound();
  return <main className="page">
    <PageHeader title="Team" description="Control practice access, professional roles and current workload." />
    <TeamManager members={members} canManage={canManageTeam(access.userRole) && access.accessLevel === "full"} actorRole={access.userRole} />
    {access.userRole === "owner" && access.accessLevel === "full" ? <ProfessionalPermissions members={members} /> : null}
    {access.userRole === "owner" ? <SupportApprovalPanel organisationSlug={organisationSlug} initialRequests={supportRequests} /> : null}
  </main>;
}
