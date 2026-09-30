import { FileClock } from "lucide-react";
import { OperationsPage } from "@/components/operations-page";
import { loadPlatformAuditQueue } from "@/lib/data";
export const metadata = { title: "Audit" };
export default async function Page() { const rows = await loadPlatformAuditQueue(); return <OperationsPage title="Global audit" description="Review immutable customer, operator and integration events across the platform." icon={FileClock} rows={rows} emptyMessage="No platform audit events have been recorded." />; }
