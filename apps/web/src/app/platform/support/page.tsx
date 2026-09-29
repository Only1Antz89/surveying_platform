import { Headphones } from "lucide-react";
import { OperationsPage, supportRows } from "@/components/operations-page";
export const metadata = { title: "Support access" };
export default function Page() { return <OperationsPage title="Support access" description="Approve and inspect time-limited customer support sessions without impersonation." icon={Headphones} rows={supportRows} />; }
