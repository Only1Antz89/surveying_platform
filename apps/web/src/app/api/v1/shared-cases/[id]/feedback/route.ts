import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { feedbackInput, recordCaseFeedback } from "@/lib/learning";
import { learningRoute } from "@/lib/learning-route";

export const runtime = "nodejs";

/** Feedback on a shared case for reviewers; never used for training. "Identifying" takes the case out of retrieval at once. */
export async function POST(request: Request, route: RouteContext<"/api/v1/shared-cases/[id]/feedback">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const parsed = await parseBody(request, feedbackInput);
  if (!parsed.success) return problem(400, "invalid_request", "The feedback is invalid.", parsed.error.flatten());
  const { id } = await route.params;
  if (context.demo) return ok({ feedback: parsed.data, suspended: false }, { demo: true, persisted: false });
  if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "The shared case could not be found.");
  return learningRoute(() => recordCaseFeedback(context, id, parsed.data));
}
