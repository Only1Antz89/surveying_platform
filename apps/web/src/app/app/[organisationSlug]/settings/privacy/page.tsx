import { notFound } from "next/navigation";
import { requireWorkspacePageAccess } from "@/lib/workspace-page-access";
import { PageHeader } from "@/components/page-header";
import { SecurityPrivacySettings } from "@/components/security-privacy-settings";

export const metadata = { title: "Security & privacy" };
export const dynamic = "force-dynamic";
export default async function Page({ params }: PageProps<"/app/[organisationSlug]/settings/privacy">) {
  const access = await requireWorkspacePageAccess((await params).organisationSlug, "settings");
  if (!["owner", "administrator"].includes(access.userRole)) notFound();
  return <main className="page"><PageHeader title="Security & privacy" description="Sign-in policy and data protection requests for your practice." /><SecurityPrivacySettings isOwner={access.userRole === "owner"} canEdit={access.accessLevel === "full"} preview={access.userId === "demo_user"} /></main>;
}
