import { AppShell } from "@/components/app-shell";
import { requirePlatformAccess } from "@/lib/access";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) { await requirePlatformAccess(); return <AppShell mode="platform">{children}</AppShell>; }
