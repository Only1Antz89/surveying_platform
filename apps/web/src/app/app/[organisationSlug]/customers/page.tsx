import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import { operationsPage } from "@/lib/operations-page";
import { PageHeader } from "@/components/page-header";
import { ClientRegister } from "@/components/client-register";
import { loadClients } from "@/lib/data";
import { canMutateOperations } from "@surveynt/domain";
import { isManagementRole } from "@surveynt/domain";
import { notFound } from "next/navigation";
import { WebsiteEnquiries } from "@/components/website-enquiries";
import Link from "@/components/workspace-link";
import { ReferralSources } from "@/components/referral-sources";
import { ClientMessagesSettings } from "@/components/client-messages-settings";

export const metadata = { title: "CRM Suite" }; export const dynamic = "force-dynamic";
export default async function Page({ params,searchParams }: PageProps<"/app/[organisationSlug]/customers">) {
  const { organisationSlug } = await params;
  const access = await requireWorkspacePageAccess(organisationSlug, "customers");
  const query = await searchParams;

  if (query.view === "referrals") {
    if (!isManagementRole(access.userRole)) notFound();
    return <main className="page"><PageHeader title="Referral sources" description="Where instructions come from and what each source is worth."/><ReferralSources canEdit={access.accessLevel === "full"}/></main>;
  }
  if (query.view === "messages") {
    if (!isManagementRole(access.userRole)) notFound();
    return <main className="page"><PageHeader title="Client messages" description="Reminders, updates and review requests your clients receive."/><ClientMessagesSettings canEdit={access.accessLevel === "full"}/></main>;
  }
  if (query.view === "enquiries") {
    if (!isManagementRole(access.userRole)) notFound();
    return <main className="page"><PageHeader title="Website enquiries" description="Customer requests collected through your website form."/><WebsiteEnquiries canEdit={access.accessLevel === "full" && access.userId !== "demo_user"}/></main>;
  }
  if (query.view === "quotes") return operationsPage("customers", params);

  const clients = await loadClients(organisationSlug);
  return <main className="page"><PageHeader title="CRM suite" description="People and organisations, connected to their properties and survey work."/><nav className="action-row" aria-label="CRM views"><Link className="button button-secondary" href={`/app/${organisationSlug}/customers?view=quotes`}>Quotes & instructions</Link><Link className="button button-secondary" href={`/app/${organisationSlug}/customers?view=enquiries`}>Website enquiries</Link></nav><ClientRegister organisationSlug={organisationSlug} clients={clients} canEdit={access.accessLevel==="full"&&canMutateOperations(access.userRole) && access.userRole !== "surveyor"}/></main>;
}
