import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { searchSharedCases, sharedCaseNotice } from "@/lib/shared-cases";

export const runtime = "nodejs";

/** Reviewed shared cases from the active release, filtered by element, jurisdiction and words. The same for every firm. */
export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const params = new URL(request.url).searchParams;
  if (context.demo) return ok({ available: false, reason: "Shared learning is not active on Surveynt.", release: null, cases: [], notice: sharedCaseNotice }, { demo: true });
  return ok(await searchSharedCases({ elementKey: params.get("element"), jurisdiction: params.get("jurisdiction"), query: params.get("q") }));
}
