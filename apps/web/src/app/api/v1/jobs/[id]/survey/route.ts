import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { serviceLevels } from "@surveynt/assistant";
import { createDatabase, surveys, withTenant } from "@surveynt/db";
import { canMutateOperations, ukCountries } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { createSurvey } from "@/lib/surveys";
import { refreshSurveyProposals } from "@/lib/proposals";

export const runtime = "nodejs";

const createBody = z.object({
  serviceLevel: z.enum(serviceLevels),
  jurisdiction: z.enum(ukCountries).optional(),
  templateKey: z.string().max(80).optional(),
  templateVersion: z.string().max(20).optional(),
  clientGeneratedId: z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/).optional(),
});

export async function GET(request: Request, route: RouteContext<"/api/v1/jobs/[id]/survey">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const { id } = await route.params;
  if (context.demo) return ok({ surveyId: `demo-survey-${id}` }, { demo: true });
  if (!z.uuid().safeParse(id).success) return problem(404, "job_not_found", "The job could not be found.");
  const [survey] = await withTenant(createDatabase(), context.organisationId, (tx) => tx.select({ id: surveys.id }).from(surveys).where(and(eq(surveys.organisationId, context.organisationId), eq(surveys.jobId, id), ne(surveys.status, "withdrawn"))).limit(1));
  return ok({ surveyId: survey?.id ?? null });
}

/** Starts the survey for a job, or returns the one already in progress (idempotent). */
export async function POST(request: Request, route: RouteContext<"/api/v1/jobs/[id]/survey">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot start surveys.");
  const parsed = await parseBody(request, createBody);
  if (!parsed.success) return problem(400, "invalid_request", "Choose the service scope for this survey.", parsed.error.flatten());
  const { id } = await route.params;
  if (context.demo) return ok({ surveyId: `demo-survey-${id}`, created: false }, { demo: true, persisted: false });
  if (!z.uuid().safeParse(id).success) return problem(404, "job_not_found", "The job could not be found.");
  const result = await createSurvey({ organisationId: context.organisationId, internalUserId: context.internalUserId, role: context.role }, id, parsed.data);
  if (result.kind === "missing") return problem(404, "job_not_found", "The job could not be found.");
  if (result.kind === "invalid") return problem(422, "survey_rejected", result.message);
  if (result.kind === "created") await refreshSurveyProposals(context, result.survey.id).catch(() => undefined);
  return ok({ surveyId: result.survey.id, created: result.kind === "created" });
}
