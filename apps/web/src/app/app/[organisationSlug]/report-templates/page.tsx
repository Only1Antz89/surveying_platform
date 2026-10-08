import { redirect } from "next/navigation";
export default async function Page({params}:PageProps<"/app/[organisationSlug]/report-templates">){redirect(`/app/${(await params).organisationSlug}/reports?view=templates`);}
