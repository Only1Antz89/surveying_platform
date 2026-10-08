import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import { createHash } from "node:crypto";
import { canConfirmPropertyIdentity, hasProfessionalPermission } from "@surveynt/domain";
import { SurveyEntry } from "@/components/survey/survey-entry";
import { requireFirmAccess } from "@/lib/access";

export const metadata = { title: "Survey" };

// The page shell carries no survey content. Survey data is fetched by the client
// and kept in the device's offline store, so the shell can be cached for offline use.
export default async function SurveyPage({ params }: PageProps<"/app/[organisationSlug]/jobs/[id]/survey">) {
  const { organisationSlug, id } = await params; await requireWorkspacePageAccess(organisationSlug, "jobs");
  const access = await requireFirmAccess(organisationSlug);
  const canEdit = access.accessLevel === "full" && canConfirmPropertyIdentity(access.userRole, access.canRecordSurvey);
  // Opaque per-user, per-firm key for the device store; raw identifiers are not exposed.
  const offlineScope = createHash("sha256").update(`${access.userId}:${access.organisationId}`).digest("hex").slice(0, 32);
  return <main className="page">{!canEdit ? <section className="panel"><div className="panel-body"><strong>Professional recording permission required</strong><p>You can view this survey. An owner must grant recording permission before you can enter findings. Report approval is a separate permission.</p></div></section> : null}<SurveyEntry slug={organisationSlug} jobId={id} offlineScope={offlineScope} canEdit={canEdit} canJudge={canEdit} canApprove={access.accessLevel === "full" && hasProfessionalPermission(access.userRole, "approve_reports", access.canApproveReports)} /></main>;
}
