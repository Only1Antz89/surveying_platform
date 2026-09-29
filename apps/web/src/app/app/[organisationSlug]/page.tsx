import { redirect } from "next/navigation";

export default async function FirmHome({ params }: { params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params;
  redirect(`/app/${organisationSlug}/overview`);
}
