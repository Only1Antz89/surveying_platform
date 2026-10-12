import {requireWorkspacePageAccess} from "@/lib/workspace-page-access";
import {listLocations} from "@/lib/staff-operations";
import {LocationsManager} from "@/components/locations-manager";
import {PageHeader} from "@/components/page-header";
export default async function Page({params}:{params:Promise<{organisationSlug:string}>}){const {organisationSlug}=await params;const c=await requireWorkspacePageAccess(organisationSlug,"locations");const locations=await listLocations({organisationId:c.organisationId,internalUserId:c.internalUserId,role:c.userRole,demo:c.userId==="demo_user"});return <main className="page"><PageHeader eyebrow="Multi-site practice" title="Locations & routing" description="Operating sites, staff coverage and consistent route planning across your practice."/><LocationsManager slug={organisationSlug} initial={locations} canEdit={c.accessLevel==="full"&&["owner","administrator"].includes(c.userRole)}/></main>;}
