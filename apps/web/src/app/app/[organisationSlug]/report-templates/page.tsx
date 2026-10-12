import {redirectWorkspace as redirect} from "@/lib/workspace-redirect";
export default async function Page({params}:PageProps<"/app/[organisationSlug]/report-templates">){await redirect(`/app/${(await params).organisationSlug}/reports?view=templates`);}
