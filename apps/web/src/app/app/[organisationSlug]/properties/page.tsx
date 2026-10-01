import { PageHeader } from "@/components/page-header";
import { PropertyRegister } from "@/components/property-register";
import { loadClients, loadProperties } from "@/lib/data";
import { canMutateOperations } from "@surveynt/domain";
import { requireFirmAccess } from "@/lib/access";

export const metadata = { title: "Properties" };

export default async function PropertiesPage({ params }: { params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params;
  const [properties, clients, access] = await Promise.all([loadProperties(organisationSlug), loadClients(organisationSlug), requireFirmAccess(organisationSlug)]);
  return <main className="page"><PageHeader title="Properties" description="A single property record for every address, linked to its clients and active work." /><PropertyRegister properties={properties} clients={clients} organisationSlug={organisationSlug} canEdit={access.accessLevel === "full" && canMutateOperations(access.userRole)} /></main>;
}
