import { AppShell } from "@/components/app-shell";
import { requireFirmAccess } from "@/lib/access";

export default async function FirmLayout({ children, params }: { children: React.ReactNode; params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params;
  await requireFirmAccess(organisationSlug);
  return <AppShell mode="firm" slug={organisationSlug}>{children}</AppShell>;
}
