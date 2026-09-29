import { FileClock } from "lucide-react";
import { OperationsPage, auditRows } from "@/components/operations-page";
export const metadata = { title: "Audit" };
export default function Page() { return <OperationsPage title="Global audit" description="Search immutable customer, operator and integration events across FIELDNOTE." icon={FileClock} rows={auditRows} />; }
