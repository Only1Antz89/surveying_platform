import {redirectWorkspace as redirect} from "@/lib/workspace-redirect";
export default async function Page({params}:PageProps<"/app/[organisationSlug]/clients">){await redirect(`/app/${(await params).organisationSlug}/customers`);}
