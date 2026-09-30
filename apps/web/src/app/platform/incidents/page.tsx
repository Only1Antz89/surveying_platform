import { AlertTriangle } from "lucide-react";
import { OperationsPage } from "@/components/operations-page";
import { loadPlatformIncidentQueue } from "@/lib/data";
export const metadata = { title: "Incidents" };
export default async function Page() { const rows = await loadPlatformIncidentQueue(); return <OperationsPage title="Incidents" description="Coordinate security, availability and data incidents with accountable ownership." icon={AlertTriangle} rows={rows} emptyMessage="No failed jobs or integrations currently require attention." />; }
