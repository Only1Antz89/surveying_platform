import { AssistantOversight } from "@/components/assistant-oversight";
import { requirePlatformAccess } from "@/lib/access";
import { loadAssistantMetrics, loadModelRegister } from "@/lib/ai-governance";

export const metadata = { title: "Assistant oversight" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const operator = await requirePlatformAccess();
  const demo = !process.env.DATABASE_ADMIN_URL || operator.userId === "demo_platform_user";
  const [metrics, register] = demo ? [null, []] : await Promise.all([loadAssistantMetrics(), loadModelRegister()]);
  return <>
    <header className="page-header"><div><span className="eyebrow">Platform operations</span><h1>Assistant oversight</h1><p>Evaluation outcomes, AI governance and operations across all firms. Totals only; no firm is named.</p></div></header>
    <AssistantOversight metrics={metrics} register={register} canManage={operator.role === "super_admin" || operator.role === "compliance"} demo={demo} />
  </>;
}
