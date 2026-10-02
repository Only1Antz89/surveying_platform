import { z } from "zod";
import { composeReport, type FieldValue, type InspectionStatus, type ServiceLevel } from "@surveynt/assistant";
import { canMutateOperations } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { demoSurveyPack } from "@/lib/demo-survey";
import { demoClauses } from "@/lib/demo-wording";
import { composeSurveyReport, loadSurveyReports, ReportError } from "@/lib/reports";

export const runtime = "nodejs";

/** Labelled demo: a few invented records composed with the demo clauses. Nothing is stored. */
function demoReport(surveyId: string) {
  const pack = demoSurveyPack(surveyId.replace(/^demo-survey-/, ""));
  if (!pack) return null;
  const value = (id: string, fieldPath: string, value: FieldValue) => ({ id, fieldPath, value });
  return composeReport({
    template: pack.template, serviceLevel: pack.survey.serviceLevel as ServiceLevel, jurisdiction: pack.survey.jurisdiction, job: { reference: pack.job.reference }, property: { line1: pack.property.line1, city: pack.property.city, postcode: pack.property.postcode },
    values: [
      value("demo-v1", "about.property.property_type", { state: "provided", value: "house" }),
      value("demo-v2", "inspection.visit.inspection_date", { state: "provided", value: "2026-09-28" }),
      value("demo-v3", "outside.roof_coverings.condition_rating", { state: "provided", value: "3" }),
      value("demo-v4", "outside.roof_coverings.commentary", { state: "provided", value: "DEMO: several slates have slipped on the rear slope and the ridge mortar is loose." }),
      value("demo-v5", "outside.chimneys.condition_rating", { state: "provided", value: "NI" }),
      value("demo-v6", "summary.opinion.overall_opinion", { state: "provided", value: "DEMO: the property is in reasonable condition for its age, subject to the roof repairs noted." }),
    ],
    elements: [
      { id: "demo-e1", sectionKey: "outside", elementKey: "roof_coverings", locationLabel: "", inspectionStatus: "inspected" as InspectionStatus, limitationReason: null },
      { id: "demo-e2", sectionKey: "outside", elementKey: "chimneys", locationLabel: "", inspectionStatus: "inaccessible" as InspectionStatus, limitationReason: "DEMO: no safe view of the stack from the ground." },
    ],
    observations: [{ id: "demo-o1", elementId: "demo-e1", kind: "current_observation", text: "DEMO: four slipped slates.", locationLabel: "Rear slope", structured: { defect: { nextAction: "repair" } }, version: 1 }],
    evidence: [], media: [], clauses: demoClauses,
  }).report;
}

/** Report versions for the survey (newest first) with the latest content, sign-off state and whether each still matches the survey. */
export async function GET(request: Request, route: RouteContext<"/api/v1/surveys/[id]/report">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const { id } = await route.params;
  if (context.demo) return ok({ surveyStatus: "in_progress", currentFingerprint: "demo", versions: [], latest: null }, { demo: true });
  if (!z.uuid().safeParse(id).success) return problem(404, "survey_not_found", "The survey could not be found.");
  const reports = await loadSurveyReports(context, id);
  return reports ? ok(reports) : problem(404, "survey_not_found", "The survey could not be found.");
}

/** Composes a new immutable draft version from recorded values, current observations and approved wording only. */
export async function POST(request: Request, route: RouteContext<"/api/v1/surveys/[id]/report">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot compose reports.");
  const { id } = await route.params;
  if (context.demo) {
    const report = demoReport(id);
    return report ? ok({ id: "demo-report", versionNumber: 1, content: report, omissions: report.omissions }, { demo: true, persisted: false }) : problem(404, "survey_not_found", "The survey could not be found.");
  }
  if (!z.uuid().safeParse(id).success) return problem(404, "survey_not_found", "The survey could not be found.");
  try {
    return ok(await composeSurveyReport(context, id));
  } catch (reason) {
    if (reason instanceof ReportError) return problem(reason.status, reason.code, reason.message, reason.details);
    throw reason;
  }
}
