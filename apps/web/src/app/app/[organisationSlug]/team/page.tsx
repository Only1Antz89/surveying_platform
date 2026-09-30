import { canManageTeam } from "@fieldnote/domain";
import { PageHeader } from "@/components/page-header";
import { TeamManager } from "@/components/team-manager";
import { requireFirmAccess } from "@/lib/access";
import { loadMembers } from "@/lib/data";

export const metadata = { title: "Team" };

export default async function TeamPage({ params }: { params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params;
  const [members, access] = await Promise.all([loadMembers(organisationSlug), requireFirmAccess(organisationSlug)]);
  return <main className="page">
    <PageHeader title="Team" description="Control practice access, professional roles and current workload." />
    <TeamManager members={members} canManage={canManageTeam(access.userRole) && access.accessLevel === "full"} actorRole={access.userRole} />
  </main>;
}
