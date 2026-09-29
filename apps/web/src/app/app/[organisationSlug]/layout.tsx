import { AppShell } from "@/components/app-shell";
import { requireFirmAccess } from "@/lib/access";

export default async function FirmLayout({ children, params }: { children: React.ReactNode; params: Promise<{ organisationSlug: string }> }) {
  const { organisationSlug } = await params;
  const context = await requireFirmAccess(organisationSlug);
  const trialEnds = context.trialEndsAt?.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }) ?? null;
  return <AppShell mode="firm" slug={organisationSlug} workspace={{
    name: context.organisationName,
    region: context.organisationRegion,
    userName: context.userName,
    userRole: context.userRole,
    trialEnds,
  }}>{children}</AppShell>;
}
