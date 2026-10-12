import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import {redirectWorkspace as redirect} from "@/lib/workspace-redirect";

export default async function FirmHome({ params }: { params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params; await requireWorkspacePageAccess(organisationSlug, "");
  await redirect(`/app/${organisationSlug}/overview`);
}
