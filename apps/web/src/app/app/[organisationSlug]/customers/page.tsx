import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import { operationsPage } from "@/lib/operations-page";
import { PageHeader } from "@/components/page-header";
import { ClientRegister } from "@/components/client-register";
import { loadClients } from "@/lib/data";
import { canMutateOperations } from "@surveynt/domain";
import { isManagementRole } from "@surveynt/domain";
import { notFound } from "next/navigation";
import { WebsiteEnquiries } from "@/components/website-enquiries";
import { ManagerCrm } from "@/components/manager-crm";

export const metadata = { title: "CRM Suite" }; export const dynamic = "force-dynamic";
export default async function Page({ params,searchParams }: PageProps<"/app/[organisationSlug]/customers">) {
  const { organisationSlug } = await params;
  const access = await requireWorkspacePageAccess(organisationSlug, "customers");
  const query = await searchParams;

  if (query.view === "enquiries") {
    if (!isManagementRole(access.userRole)) notFound();
    return <main className="page"><PageHeader title="Website enquiries" description="Customer requests collected through your website form."/><WebsiteEnquiries canEdit={access.accessLevel === "full" && access.userId !== "demo_user"}/></main>;
  }
  if (query.view === "quotes") return operationsPage("customers", params);

  if (access.workspaceMode === "manager" || access.userId === "demo_user") {
    return (
      <main className="page">
        <ManagerCrm slug={organisationSlug} />
      </main>
    );
  }

  const clients = await loadClients(organisationSlug);
  return <main className="page"><PageHeader title="Customers" description="People and organisations, connected to their properties and survey work."/><ClientRegister organisationSlug={organisationSlug} clients={clients} canEdit={access.accessLevel==="full"&&canMutateOperations(access.userRole) && access.userRole !== "surveyor"}/></main>;
}
