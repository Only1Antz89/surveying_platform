import { z } from "zod";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { upgradeHomeSurveyTemplate } from "@/lib/surveys";

export async function POST(request: Request, route: RouteContext<"/api/v1/surveys/[id]/template">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in to your practice.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (context.demo || !canWriteWorkspace(context)) return problem(403, "workspace_read_only", "A writable persistent demo is required.");
  const parsed = z.object({ version: z.number().int().positive(), confirm: z.literal(true) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return problem(400, "confirmation_required", "Confirm the explicit upgrade and current survey version.");
  const result = await upgradeHomeSurveyTemplate(context, (await route.params).id, parsed.data.version);
  if (result.kind === "denied") return problem(403, "upgrade_not_available", "Professional recording permission and an enabled private demo are required.");
  if (result.kind === "missing") return problem(404, "survey_not_found", "The survey could not be found.");
  if (result.kind !== "upgraded") return problem(409, "upgrade_conflict", "Reload the survey. Only open Home Survey 1.0/1.1 forms can be upgraded.");
  return ok(result);
}
