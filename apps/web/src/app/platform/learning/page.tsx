import { LearningConsole } from "@/components/learning-console";
import { requirePlatformAccess } from "@/lib/access";
import { canViewLearning, loadLearningConsole } from "@/lib/learning-admin";

export const metadata = { title: "Shared learning" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const operator = await requirePlatformAccess();
  const demo = !process.env.DATABASE_ADMIN_URL || operator.userId === "demo_platform_user";
  const allowed = canViewLearning(operator.role);
  const data = demo || !allowed ? null : await loadLearningConsole();
  return <>
    <header className="page-header"><div><span className="eyebrow">Platform operations</span><h1>Shared learning</h1><p>Contribution policy, restricted staging and review. Disabled by default; firms are identified only by pseudonymous keys.</p></div></header>
    {allowed || demo ? <LearningConsole initial={data} role={operator.role} demo={demo} /> : <p className="form-help">A shared-learning role (privacy reviewer, technical reviewer, release manager or compliance) is required.</p>}
  </>;
}
