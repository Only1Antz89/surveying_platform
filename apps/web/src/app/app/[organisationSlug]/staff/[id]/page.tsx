import {notFound} from "next/navigation";
import {requireWorkspacePageAccess} from "@/lib/workspace-page-access";
import {staffProfile} from "@/lib/staff-operations";
import {StaffProfile} from "@/components/staff-profile";
import {PageHeader} from "@/components/page-header";
export default async function Page({params}:{params:Promise<{organisationSlug:string;id:string}>}){const {organisationSlug,id}=await params;const c=await requireWorkspacePageAccess(organisationSlug,"staff");if(c.userId!=="demo_user"&&!/^[\da-f-]{36}$/i.test(id))notFound();const profile=await staffProfile({organisationId:c.organisationId,internalUserId:c.internalUserId,role:c.userRole,demo:c.userId==="demo_user"},id);if(!profile)notFound();return <main className="page"><PageHeader eyebrow="Practice people" title="Staff profile" description="Professional services, workload and declared operating coverage."/><StaffProfile profile={profile} canEdit={c.accessLevel==="full"&&["owner","administrator"].includes(c.userRole)}/></main>;}
