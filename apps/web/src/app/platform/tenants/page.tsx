import { PageHeader } from "@/components/page-header";
import { TenantDirectory } from "@/components/tenant-directory";
import { loadTenants } from "@/lib/data";
import { CapabilityPanel } from "@/components/capability-panel";
import { requirePlatformAccess } from "@/lib/access";
import { canManagePlatformIntegrations } from "@/lib/integration-access";

export const metadata = { title: "Customers" };
export const dynamic = "force-dynamic";
export default async function TenantsPage() { const [tenants,operator] = await Promise.all([loadTenants(),requirePlatformAccess()]); return <main className="page"><PageHeader eyebrow="Platform operations" title="Customer accounts" description="Monitor every firm from initial signup through trial, subscription and ongoing support." /><TenantDirectory tenants={tenants} />{canManagePlatformIntegrations(operator.role)?<CapabilityPanel scope="platform"/>:null}</main>; }
