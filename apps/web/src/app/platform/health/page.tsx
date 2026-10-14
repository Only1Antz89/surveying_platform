import { PlatformHealth } from "@/components/platform-health";
import { requirePlatformAccess } from "@/lib/access";
import { listServerErrors } from "@/lib/error-reporting";
export const metadata = { title: "Service health" };
export const dynamic = "force-dynamic";
export default async function Page() {
  const operator = await requirePlatformAccess();
  const preview = operator.userId === "demo_platform_user" || !process.env.DATABASE_ADMIN_URL;
  return <PlatformHealth initial={preview ? [] : await listServerErrors()} preview={preview} canResolve={["super_admin", "support", "compliance"].includes(operator.role)} />;
}
