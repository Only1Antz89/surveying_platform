import { Activity } from "lucide-react";
import { OperationsPage, type OperationRow } from "@/components/operations-page";
const rows: OperationRow[] = [{ primary: "Southbank Property Advisory", secondary: "Practice · 8 seats", state: "91% used", detail: "1,842 API operations this month", action: "Inspect usage", tone: "amber" }, { primary: "North Star Surveying", secondary: "Trial · 5 seats", state: "68% used", detail: "742 API operations this month", action: "Inspect usage", tone: "blue" }];
export const metadata = { title: "Usage" };
export default function Page() { return <OperationsPage title="Usage and entitlements" description="Understand how customer accounts consume seats, storage and workflow allowances." icon={Activity} rows={rows} />; }
