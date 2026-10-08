import { isManagementRole } from "@surveynt/domain";
import { notFound } from "next/navigation";
import { requireFirmAccess } from "@/lib/access";
export default async function SettingsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params;
  const access = await requireFirmAccess(organisationSlug);
  if (!isManagementRole(access.userRole)) notFound();
  return children;
}
