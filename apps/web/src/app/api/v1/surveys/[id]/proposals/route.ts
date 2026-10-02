import { z } from "zod";
import { canMutateOperations } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { assistantEnabled } from "@/lib/assistant-flags";
import { listSurveyProposals, refreshSurveyProposals } from "@/lib/proposals";

export const runtime = "nodejs";

export async function GET(request: Request, route: RouteContext<"/api/v1/surveys/[id]/proposals">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const { id } = await route.params;
  if (context.demo) return ok([], { demo: true });
  if (!z.uuid().safeParse(id).success) return problem(404, "survey_not_found", "The survey could not be found.");
  if (!assistantEnabled()) return ok([], { assistantEnabled: false });
  const rows = await listSurveyProposals(context, id);
  return ok(rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), reviewedAt: row.reviewedAt?.toISOString() ?? null })));
}

/** Regenerates deterministic, source-grounded suggestions for an open survey. */
export async function POST(request: Request, route: RouteContext<"/api/v1/surveys/[id]/proposals">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot refresh suggestions.");
  const { id } = await route.params;
  if (context.demo) return ok({ created: 0, superseded: 0, discrepancies: 0 }, { demo: true });
  if (!z.uuid().safeParse(id).success) return problem(404, "survey_not_found", "The survey could not be found.");
  if (!assistantEnabled()) return problem(503, "assistant_disabled", "Suggestions are turned off for this deployment.");
  return ok(await refreshSurveyProposals(context, id));
}
