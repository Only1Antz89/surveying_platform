import { AlertTriangle } from "lucide-react";
import { OperationsPage } from "@/components/operations-page";
export const metadata = { title: "Incidents" };
export default function Page() { return <OperationsPage title="Incidents" description="Coordinate security, availability and data incidents with accountable ownership." icon={AlertTriangle} rows={[]} emptyMessage="No open platform incidents." />; }
