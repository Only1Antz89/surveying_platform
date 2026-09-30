import { Activity } from "lucide-react";
import { OperationsPage } from "@/components/operations-page";
import { loadPlatformUsageQueue } from "@/lib/data";
export const metadata = { title: "Usage" };
export default async function Page() { const rows = await loadPlatformUsageQueue(); return <OperationsPage title="Usage and entitlements" description="Understand how customer accounts consume seats and operational records." icon={Activity} rows={rows} emptyMessage="No customer usage has been recorded." />; }
