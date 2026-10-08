import { notFound } from "next/navigation";
import { requireFirmAccess } from "@/lib/access";
import { websiteFormEditorRole } from "@/lib/website-form";
import { studioContext, studioData } from "@/lib/website-form-studio-data";
import { WebsiteFormPreview } from "@/components/website-form-preview";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params, access = await requireFirmAccess(organisationSlug);
  if (!websiteFormEditorRole(access.userRole)) notFound();
  return <WebsiteFormPreview initial={studioContext(await studioData(access, organisationSlug))}/>;
}
