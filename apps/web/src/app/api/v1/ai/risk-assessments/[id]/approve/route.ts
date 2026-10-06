import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { approveRiskAssessment } from "@/lib/ai-governance";
import { governed } from "@/lib/governance-route";

export const runtime = "nodejs";

/** Approves a draft risk assessment (owners and administrators); an earlier approval for the same use is superseded. */
export async function POST(request: Request, route: RouteContext<"/api/v1/ai/risk-assessments/[id]/approve">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const { id } = await route.params;
  if (context.demo) return ok({ id, status: "approved" }, { demo: true, persisted: false });
  if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "The risk assessment could not be found.");
  return governed(() => approveRiskAssessment(context, id));
}
