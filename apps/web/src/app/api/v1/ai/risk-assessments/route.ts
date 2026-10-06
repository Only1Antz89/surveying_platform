import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { createRiskAssessment, riskAssessmentInput } from "@/lib/ai-governance";
import { governed } from "@/lib/governance-route";

export const runtime = "nodejs";

/** Drafts a risk assessment for one AI use. */
export async function POST(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const parsed = await parseBody(request, riskAssessmentInput);
  if (!parsed.success) return problem(400, "invalid_request", "The risk assessment is invalid.", parsed.error.flatten());
  if (context.demo) return ok({ ...parsed.data, id: crypto.randomUUID(), status: "draft" }, { demo: true, persisted: false });
  return governed(() => createRiskAssessment(context, parsed.data));
}
