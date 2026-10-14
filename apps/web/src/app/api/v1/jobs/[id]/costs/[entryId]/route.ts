import { apiContext } from "@/lib/access";
import { invalidId, ok, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { JobCostError, removeCostEntry } from "@/lib/job-costs";

export async function DELETE(request: Request, route: RouteContext<"/api/v1/jobs/[id]/costs/[entryId]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (context.accessLevel !== "full") return problem(403, "read_only", "Changing costs requires an active workspace.");
  const { id, entryId } = await route.params;
  if (context.demo) return ok({ id: entryId }, { demo: true, persisted: false });
  const invalid = invalidId(context, id, entryId);
  if (invalid) return invalid;
  try { return ok(await removeCostEntry(context, id, entryId)); }
  catch (error) { if (error instanceof JobCostError) return problem(error.status, error.code, error.message); throw error; }
}
