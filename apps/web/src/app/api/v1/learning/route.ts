import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { loadLearningDashboard } from "@/lib/learning";
import { demoLearningDashboard } from "@/lib/learning-route";

export const runtime = "nodejs";

/** The firm's shared-learning dashboard: programme state, scopes, withdrawal requests and its own counts. */
export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (context.demo) return ok(demoLearningDashboard(), { demo: true });
  return ok(await loadLearningDashboard(context));
}
