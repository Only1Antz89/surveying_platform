import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { professionalApiGuard } from "@/lib/professional-access";
import { z } from "zod";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { reopenSurvey, ReportError } from "@/lib/reports";

export const runtime = "nodejs";

/** Reopens a signed-off survey for changes before issue; a new version must then be composed and signed off. */
export async function POST(request: Request, route: RouteContext<"/api/v1/surveys/[id]/reopen">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const professionalDenial = professionalApiGuard(request, context);
  if (professionalDenial) return professionalDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const parsed = await parseBody(request, z.object({ reason: z.string().trim().min(10).max(1000) }));
  if (!parsed.success) return problem(400, "invalid_request", "Give a reason for reopening (at least 10 characters).");
  const { id } = await route.params;
  if (context.demo) return ok({ status: "in_progress" }, { demo: true, persisted: false });
  if (!z.uuid().safeParse(id).success) return problem(404, "survey_not_found", "The survey could not be found.");
  try {
    return ok(await reopenSurvey(context, id, parsed.data.reason));
  } catch (reason) {
    if (reason instanceof ReportError) return problem(reason.status, reason.code, reason.message);
    throw reason;
  }
}
