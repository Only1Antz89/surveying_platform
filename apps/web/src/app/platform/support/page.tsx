import { Headphones } from "lucide-react";
import { OperationsPage } from "@/components/operations-page";
import { loadPlatformSupportQueue } from "@/lib/data";
export const metadata = { title: "Support access" };
export const dynamic = "force-dynamic";
export default async function Page() { const rows = await loadPlatformSupportQueue(); return <OperationsPage title="Support access" description="Inspect time-limited customer support sessions without impersonation." icon={Headphones} rows={rows} emptyMessage="No support sessions have been requested." />; }
