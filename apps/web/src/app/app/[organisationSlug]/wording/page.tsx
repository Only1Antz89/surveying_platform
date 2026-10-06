import { redirect } from "next/navigation";
export default async function Page({params}:PageProps<"/app/[organisationSlug]/wording">){redirect(`/app/${(await params).organisationSlug}/reports?view=wording`);}
