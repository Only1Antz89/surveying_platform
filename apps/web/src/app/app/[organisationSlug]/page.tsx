import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import { redirect } from "next/navigation";

export default async function FirmHome({ params }: { params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params; await requireWorkspacePageAccess(organisationSlug, "");
  redirect(`/app/${organisationSlug}/overview`);
}
