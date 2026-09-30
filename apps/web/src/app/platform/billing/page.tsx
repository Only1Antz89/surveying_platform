import { CircleDollarSign } from "lucide-react";
import { OperationsPage } from "@/components/operations-page";
import { loadPlatformBillingQueue } from "@/lib/data";
export const metadata = { title: "Billing operations" };
export default async function Page() { const rows = await loadPlatformBillingQueue(); return <OperationsPage title="Billing operations" description="Monitor trials, renewals, failed payments and access grace periods." icon={CircleDollarSign} rows={rows} emptyMessage="No customer billing accounts currently require attention." />; }
