import { notFound } from "next/navigation";
import { canMutateOperations } from "@surveynt/domain";
import { PropertyIntelligenceWorkspace } from "@/components/property-intelligence-workspace";
import { requireFirmAccess } from "@/lib/access";
import { loadPropertyWorkspace } from "@/lib/data";

export const metadata = { title: "Property intelligence" };

export default async function PropertyPage({ params, searchParams }: PageProps<"/app/[organisationSlug]/properties/[propertyId]">) {
  const { organisationSlug, propertyId } = await params;
  const query = await searchParams;
  const initialTab = query.tab === "map" ? "Land & Map" : query.tab === "sources" ? "Sources" : undefined;
  const [workspace, access] = await Promise.all([loadPropertyWorkspace(organisationSlug, propertyId), requireFirmAccess(organisationSlug)]);
  if (!workspace) notFound();
  return <PropertyIntelligenceWorkspace organisationSlug={organisationSlug} property={workspace.property} clientName={workspace.clientName} jobs={workspace.jobs} events={workspace.events} canEdit={access.accessLevel === "full" && canMutateOperations(access.userRole)} initialTab={initialTab} />;
}
