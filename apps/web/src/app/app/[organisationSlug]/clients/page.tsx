import { redirect } from "next/navigation";
export default async function Page({params}:PageProps<"/app/[organisationSlug]/clients">){redirect(`/app/${(await params).organisationSlug}/customers`);}
