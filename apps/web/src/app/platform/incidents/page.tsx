import { IncidentManager } from "@/components/incident-manager";
import { loadPlatformIncidents } from "@/lib/data";
import { requirePlatformAccess } from "@/lib/access";
export const metadata = { title: "Incidents" };
export const dynamic = "force-dynamic";
export default async function Page() { const [data, operator] = await Promise.all([loadPlatformIncidents(), requirePlatformAccess()]); return <IncidentManager {...data} canManage={operator.role === "super_admin" || operator.role === "compliance"} />; }
