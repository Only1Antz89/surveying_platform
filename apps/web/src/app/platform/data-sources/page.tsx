import { DataSourceManager } from "@/components/data-source-manager";
import { requirePlatformAccess } from "@/lib/access";
import { canOperateDataSources, demoDataSourceView, loadDataSourceAdmin } from "@/lib/data-source-admin";

export const metadata = { title: "Data sources" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const operator = await requirePlatformAccess();
  const demo = !process.env.DATABASE_ADMIN_URL || operator.userId === "demo_platform_user";
  const sources = demo ? demoDataSourceView() : await loadDataSourceAdmin();
  return <DataSourceManager sources={sources} canOperate={canOperateDataSources(operator.role)} demo={demo} />;
}
