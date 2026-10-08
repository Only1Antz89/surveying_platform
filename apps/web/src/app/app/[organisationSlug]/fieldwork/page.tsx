import {requireWorkspacePageAccess} from "@/lib/workspace-page-access";
import {PageHeader} from "@/components/page-header";
import {DailyFieldwork} from "@/components/daily-fieldwork";
export default async function Page({params}:{params:Promise<{organisationSlug:string}>}){const {organisationSlug}=await params;await requireWorkspacePageAccess(organisationSlug,"fieldwork");return <main className="page"><PageHeader eyebrow="Schedule · people · locations" title="Daily fieldwork" description="One shared map for today’s appointments, surveyors and client job records."/><DailyFieldwork slug={organisationSlug}/></main>;}
