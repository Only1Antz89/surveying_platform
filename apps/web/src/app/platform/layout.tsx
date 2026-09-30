import { AppShell } from "@/components/app-shell";
import { requirePlatformAccess } from "@/lib/access";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const operator = await requirePlatformAccess();
  return <AppShell mode="platform" platformWorkspace={{ userName: operator.userName, userRole: operator.role }}>{children}</AppShell>;
}
