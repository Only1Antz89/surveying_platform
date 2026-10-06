import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { professionalApiGuard } from "@/lib/professional-access";
import { z } from "zod";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { demoSurveyPack } from "@/lib/demo-survey";
import { loadSurveyPack, TemplateIntegrityError } from "@/lib/surveys";

export const runtime = "nodejs";

/** The complete offline pack for one survey: pinned template, current values, observations, media metadata, evidence and tasks. */
export async function GET(request: Request, route: RouteContext<"/api/v1/surveys/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const professionalDenial = professionalApiGuard(request, context);
  if (professionalDenial) return professionalDenial;
  const { id } = await route.params;
  if (context.demo) {
    const pack = demoSurveyPack(id.replace(/^demo-survey-/, ""));
    return pack ? ok(pack, { demo: true }) : problem(404, "survey_not_found", "The survey could not be found.");
  }
  if (!z.uuid().safeParse(id).success) return problem(404, "survey_not_found", "The survey could not be found.");
  try {
    const pack = await loadSurveyPack(context, id);
    return pack ? ok(pack, { retrievedAt: new Date().toISOString() }) : problem(404, "survey_not_found", "The survey could not be found.");
  } catch (reason) {
    if (reason instanceof TemplateIntegrityError) return problem(409, "template_integrity", reason.message);
    throw reason;
  }
}
