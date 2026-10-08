import { AppShell } from "@/components/app-shell";
import { requirePlatformAccess } from "@/lib/access";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const operator = await requirePlatformAccess();
  return <AppShell polishEnabled={process.env.SURVEYNT_NEW_UI!=="false"} mode="platform" platformWorkspace={{ userName: operator.userName, userRole: operator.role }}>{children}</AppShell>;
}
