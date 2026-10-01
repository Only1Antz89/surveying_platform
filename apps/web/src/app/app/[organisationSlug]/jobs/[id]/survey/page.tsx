import { createHash } from "node:crypto";
import { canConfirmPropertyIdentity, canMutateOperations } from "@surveynt/domain";
import { SurveyEntry } from "@/components/survey/survey-entry";
import { requireFirmAccess } from "@/lib/access";

export const metadata = { title: "Survey" };

// The page shell carries no survey content. Survey data is fetched by the client
// and kept in the device's offline store, so the shell can be cached for offline use.
export default async function SurveyPage({ params }: PageProps<"/app/[organisationSlug]/jobs/[id]/survey">) {
  const { organisationSlug, id } = await params;
  const access = await requireFirmAccess(organisationSlug);
  const canEdit = access.accessLevel === "full" && canMutateOperations(access.userRole);
  // Opaque per-user, per-firm key for the device store; raw identifiers are not exposed.
  const offlineScope = createHash("sha256").update(`${access.userId}:${access.organisationId}`).digest("hex").slice(0, 32);
  return <main className="page"><SurveyEntry slug={organisationSlug} jobId={id} offlineScope={offlineScope} canEdit={canEdit} canJudge={canEdit && canConfirmPropertyIdentity(access.userRole)} /></main>;
}
