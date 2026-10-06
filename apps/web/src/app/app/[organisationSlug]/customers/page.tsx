import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import { operationsPage } from "@/lib/operations-page";
import { PageHeader } from "@/components/page-header";
import { ClientRegister } from "@/components/client-register";
import { loadClients } from "@/lib/data";
import { canMutateOperations } from "@surveynt/domain";
import { requireFirmAccess } from "@/lib/access";
import { isManagementRole } from "@surveynt/domain";
import { notFound } from "next/navigation";
import { WebsiteEnquiries } from "@/components/website-enquiries";
export const metadata = { title: "Customers and quotes" }; export const dynamic = "force-dynamic";
export default async function Page({ params,searchParams }: PageProps<"/app/[organisationSlug]/customers">) {
  if ((await searchParams).view === "enquiries") {
    const { organisationSlug } = await params; const access = await requireWorkspacePageAccess(organisationSlug, "customers");
    if (!isManagementRole(access.userRole)) notFound();
    return <main className="page"><PageHeader title="Website enquiries" description="Customer requests collected through your website form."/><WebsiteEnquiries canEdit={access.accessLevel === "full" && access.userId !== "demo_user"}/></main>;
  }
  if((await searchParams).view==="quotes")return operationsPage("customers",params);
  const {organisationSlug}=await params; await requireWorkspacePageAccess(organisationSlug, "customers");
  const [clients,access]=await Promise.all([loadClients(organisationSlug),requireFirmAccess(organisationSlug)]);
  return <main className="page"><PageHeader title="Customers" description="People and organisations, connected to their properties and survey work."/><ClientRegister clients={clients} canEdit={access.accessLevel==="full"&&canMutateOperations(access.userRole) && access.userRole !== "surveyor"}/></main>;
}
