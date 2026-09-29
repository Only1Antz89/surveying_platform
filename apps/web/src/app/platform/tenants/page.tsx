import { PageHeader } from "@/components/page-header";
import { TenantDirectory } from "@/components/tenant-directory";
import { loadTenants } from "@/lib/data";

export const metadata = { title: "Customers" };
export default async function TenantsPage() { const tenants = await loadTenants(); return <main className="page"><PageHeader eyebrow="Platform operations" title="Customer accounts" description="Monitor every firm from initial signup through trial, subscription and ongoing support." /><TenantDirectory tenants={tenants} /></main>; }
