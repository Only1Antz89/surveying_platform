import { z } from "zod";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { checkSurveyCompletion } from "@/lib/completion";
import { completionReportFromPack } from "@/lib/completion-input";
import { demoSurveyPack } from "@/lib/demo-survey";

export const runtime = "nodejs";

/** The full completion checklist for a survey: required fields, statuses, contradictions, rules, discrepancies and AI review. */
export async function GET(request: Request, route: RouteContext<"/api/v1/surveys/[id]/completion">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const { id } = await route.params;
  if (context.demo) {
    const pack = demoSurveyPack(id.replace(/^demo-survey-/, ""));
    const report = pack ? completionReportFromPack(pack) : null;
    return report ? ok(report, { demo: true }) : problem(404, "survey_not_found", "The survey could not be found.");
  }
  if (!z.uuid().safeParse(id).success) return problem(404, "survey_not_found", "The survey could not be found.");
  const report = await checkSurveyCompletion(context, id);
  if (report === "missing") return problem(404, "survey_not_found", "The survey could not be found.");
  if (report === "no_rules") return problem(409, "no_rule_set", "No completion rule set is available for this survey's template version.");
  return ok(report);
}
