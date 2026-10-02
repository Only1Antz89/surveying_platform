import Link from "next/link";
import { canManageTeam, canMutateOperations } from "@surveynt/domain";
import { AiGovernancePanel } from "@/components/ai-governance-panel";
import { PageHeader } from "@/components/page-header";
import { requireFirmAccess } from "@/lib/access";
import { loadAiGovernance } from "@/lib/ai-governance";

export const metadata = { title: "AI and assistant" };
export const dynamic = "force-dynamic";

export default async function AiSettingsPage({ params }: PageProps<"/app/[organisationSlug]/settings/ai">) {
  const { organisationSlug } = await params;
  const access = await requireFirmAccess(organisationSlug);
  const demo = access.userId === "demo_user";
  const governance = demo
    ? { providerConfigured: false, settings: { aiFeaturesEnabled: false, permittedUses: [], disclosureText: null, disclosureVersion: 0, version: 0 }, assessments: [], incidents: [], approvedModels: [] }
    : await loadAiGovernance(access);
  const full = access.accessLevel === "full";
  return <main className="page">
    <PageHeader title="AI and assistant" description="Control whether AI may assist your surveyors, for which purposes, and record risk assessments and incidents." />
    <div className="settings-grid">
      <nav className="settings-nav" aria-label="Settings"><Link href={`/app/${organisationSlug}/settings`}>Practice details</Link><Link href={`/app/${organisationSlug}/settings/billing`}>Billing</Link><Link className="active" href={`/app/${organisationSlug}/settings/ai`}>AI and assistant</Link><Link href={`/app/${organisationSlug}/team`}>Security</Link></nav>
      <AiGovernancePanel initial={governance} canManage={full && canManageTeam(access.userRole)} canReport={full && canMutateOperations(access.userRole)} demo={demo} />
    </div>
  </main>;
}
