import { notFound } from "next/navigation";
import { requireFirmAccess } from "@/lib/access";
import { websiteFormEditorRole } from "@/lib/website-form";
import { studioData } from "@/lib/website-form-studio-data";
import { WebsiteFormStudio } from "@/components/website-form-studio";
export const metadata = { title: "Website form studio" }; export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params, access = await requireFirmAccess(organisationSlug);
  if (!websiteFormEditorRole(access.userRole)) notFound();
  return <main className="page"><WebsiteFormStudio initial={await studioData(access, organisationSlug)} canEdit={access.accessLevel === "full" && access.userId !== "demo_user"}/></main>;
}
