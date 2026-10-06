import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { professionalApiGuard } from "@/lib/professional-access";
import { z } from "zod";
import { canMutateOperations } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { updateTask } from "@/lib/proposals";

export const runtime = "nodejs";

const body = z.object({ status: z.enum(["resolved", "dismissed"]), note: z.string().trim().max(1000).nullable() });

export async function PATCH(request: Request, route: RouteContext<"/api/v1/surveys/[id]/tasks/[taskId]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const professionalDenial = professionalApiGuard(request, context);
  if (professionalDenial) return professionalDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot update survey tasks.");
  const parsed = await parseBody(request, body);
  if (!parsed.success) return problem(400, "invalid_request", "The task update is invalid.");
  const { id, taskId } = await route.params;
  if (context.demo) return ok({ id: taskId, status: parsed.data.status }, { demo: true, persisted: false });
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(taskId).success) return problem(404, "task_not_found", "The task could not be found.");
  const task = await updateTask({ organisationId: context.organisationId, internalUserId: context.internalUserId, role: context.role, canRecordSurvey: context.canRecordSurvey, canApproveReports: context.canApproveReports }, id, taskId, parsed.data);
  return task ? ok({ id: task.id, status: task.status }) : problem(409, "task_not_open", "The task is no longer open.");
}
