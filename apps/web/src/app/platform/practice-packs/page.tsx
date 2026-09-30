import { PracticePackManager } from "@/components/practice-pack-manager";
import { loadPlatformPracticePacks } from "@/lib/data";
import { requirePlatformAccess } from "@/lib/access";
export const metadata = { title: "Practice packs" };
export default async function Page() { const [packs, operator] = await Promise.all([loadPlatformPracticePacks(), requirePlatformAccess()]); return <PracticePackManager packs={packs} canManage={operator.role === "super_admin" || operator.role === "compliance"} />; }
