import { PageHeader } from "@/components/page-header";
import { TenantDirectory } from "@/components/tenant-directory";
import { tenants } from "@/lib/demo-data";

export const metadata = { title: "Customers" };
export default function TenantsPage() { return <main className="page"><PageHeader eyebrow="Platform operations" title="Customer accounts" description="Monitor every firm from initial signup through trial, subscription and ongoing support." /><TenantDirectory tenants={tenants} /></main>; }
