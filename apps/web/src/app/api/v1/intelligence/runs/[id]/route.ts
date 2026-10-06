import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { loadRunStatus } from "@/lib/intelligence";

export const runtime = "nodejs";

export async function GET(request: Request, route: RouteContext<"/api/v1/intelligence/runs/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const { id } = await route.params;
  if (context.demo) return ok({ id, status: "completed" }, { demo: true });
  if (!z.uuid().safeParse(id).success) return problem(404, "run_not_found", "The refresh could not be found.");
  const run = await loadRunStatus(context, id);
  return run ? ok({ ...run, completedAt: run.completedAt?.toISOString() ?? null }) : problem(404, "run_not_found", "The refresh could not be found.");
}
