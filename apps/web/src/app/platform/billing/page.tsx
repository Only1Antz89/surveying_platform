import { CircleDollarSign } from "lucide-react";
import { OperationsPage, billingRows } from "@/components/operations-page";
export const metadata = { title: "Billing operations" };
export default function Page() { return <OperationsPage title="Billing operations" description="Monitor trials, renewals, failed payments and access grace periods." icon={CircleDollarSign} rows={billingRows} />; }
