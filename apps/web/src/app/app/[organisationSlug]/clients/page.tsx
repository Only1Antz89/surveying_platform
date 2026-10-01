import { PageHeader } from "@/components/page-header";
import { ClientRegister } from "@/components/client-register";
import { loadClients } from "@/lib/data";
import { canMutateOperations } from "@surveynt/domain";
import { requireFirmAccess } from "@/lib/access";

export const metadata = { title: "Clients" };
export default async function ClientsPage({ params }: { params: Promise<{ organisationSlug: string }> }) { const { organisationSlug } = await params; const [clients, access] = await Promise.all([loadClients(organisationSlug), requireFirmAccess(organisationSlug)]); return <main className="page"><PageHeader title="Clients" description="A complete register of the people and organisations your practice works with." /><ClientRegister clients={clients} canEdit={access.accessLevel === "full" && canMutateOperations(access.userRole)} /></main>; }
