import { Activity } from "lucide-react";
import { OperationsPage } from "@/components/operations-page";
import { loadPlatformUsageQueue } from "@/lib/data";
import { FeatureAdoption } from "@/components/feature-adoption";
import { requirePlatformAccess } from "@/lib/access";
export const metadata = { title: "Usage" };
export const dynamic = "force-dynamic";
export default async function Page() { const [rows, operator] = await Promise.all([loadPlatformUsageQueue(), requirePlatformAccess()]); return <><OperationsPage title="Usage and entitlements" description="Understand how customer accounts consume seats and operational records." icon={Activity} rows={rows} emptyMessage="No customer usage has been recorded." /><div className="page"><FeatureAdoption preview={operator.userId === "demo_platform_user" || !process.env.DATABASE_ADMIN_URL} /></div></>; }
