import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { professionalApiGuard } from "@/lib/professional-access";
import { z } from "zod";
import { syncRequestSchema } from "@surveynt/assistant";
import { canMutateOperations } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { after } from "next/server";
import { applySyncOperations, TemplateIntegrityError } from "@/lib/surveys";
import { refreshSurveyProposals } from "@/lib/proposals";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Applies queued offline operations in order. Results are per operation: applied, duplicate, conflict or rejected. */
export async function POST(request: Request, route: RouteContext<"/api/v1/surveys/[id]/sync">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const professionalDenial = professionalApiGuard(request, context);
  if (professionalDenial) return professionalDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot record survey data.");
  const parsed = await parseBody(request, syncRequestSchema);
  if (!parsed.success) return problem(400, "invalid_request", "The queued changes are invalid.", parsed.error.flatten());
  const { id } = await route.params;
  if (context.demo) return ok({ results: parsed.data.operations.map((operation) => ({ operationId: operation.operationId, status: "applied", record: { demo: true } })) }, { demo: true, persisted: false });
  if (!z.uuid().safeParse(id).success) return problem(404, "survey_not_found", "The survey could not be found.");
  try {
    const results = await applySyncOperations({ organisationId: context.organisationId, internalUserId: context.internalUserId, role: context.role, canRecordSurvey: context.canRecordSurvey, canApproveReports: context.canApproveReports }, id, parsed.data.operations);
    // Field edits can supersede suggestions or reveal discrepancies; refresh after responding.
    if (results.some((result, index) => result.status === "applied" && parsed.data.operations[index].type === "set_field")) after(() => refreshSurveyProposals(context, id).then(() => undefined, () => undefined));
    return ok({ results });
  } catch (reason) {
    if (reason instanceof TemplateIntegrityError) return problem(409, "template_integrity", reason.message);
    throw reason;
  }
}
