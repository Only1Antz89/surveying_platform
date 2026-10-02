import { notFound } from "next/navigation";
import { canConfirmPropertyIdentity, canMutateOperations } from "@surveynt/domain";
import { PropertyWorkspace } from "@/components/property-workspace";
import { requireFirmAccess } from "@/lib/access";
import { loadPropertyWorkspace } from "@/lib/property-workspace";

export const metadata = { title: "Property record" };

export default async function PropertyPage({ params }: PageProps<"/app/[organisationSlug]/properties/[id]">) {
  const { organisationSlug, id } = await params;
  const [access, data] = await Promise.all([requireFirmAccess(organisationSlug), loadPropertyWorkspace(organisationSlug, id)]);
  if (!data) notFound();
  const canEdit = access.accessLevel === "full" && canMutateOperations(access.userRole);
  return <main className="page"><PropertyWorkspace slug={organisationSlug} data={data} canEdit={canEdit} canConfirm={canEdit && canConfirmPropertyIdentity(access.userRole)} /></main>;
}
