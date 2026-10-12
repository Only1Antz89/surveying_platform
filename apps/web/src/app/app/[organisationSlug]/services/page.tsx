import {requireWorkspacePageAccess} from "@/lib/workspace-page-access";
import {PageHeader} from "@/components/page-header";
import {ServiceCatalogue} from "@/components/service-catalogue";
export default async function Page({params}:{params:Promise<{organisationSlug:string}>}){const c=await requireWorkspacePageAccess((await params).organisationSlug,"services");return <main className="page"><PageHeader eyebrow="Practice catalogue" title="Services offered" description="Manage surveying services, current pricing and customer instructions."/><ServiceCatalogue canEdit={c.accessLevel==="full"&&["owner","administrator"].includes(c.userRole)}/></main>;}
