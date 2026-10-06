import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { aiUses, evaluateAiGate } from "@surveynt/assistant";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { consentInput, loadJobAiStatus, recordAiConsent } from "@/lib/ai-governance";
import { governed } from "@/lib/governance-route";

export const runtime = "nodejs";

/** Consent history for the job and, per AI use, whether the governance gate would allow it and why not. */
export async function GET(request: Request, route: RouteContext<"/api/v1/jobs/[id]/ai-consent">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  const { id } = await route.params;
  if (context.demo) return ok({ consents: [], gates: aiUses.map((use) => evaluateAiGate({ providerKey: "none", register: [], settings: null, riskAssessments: [], consent: null, openIncidents: [], today: new Date().toISOString().slice(0, 10) }, use)) }, { demo: true });
  if (!z.uuid().safeParse(id).success) return problem(404, "job_not_found", "The job could not be found.");
  return ok(await loadJobAiStatus(context, id));
}

/** Records the client's AI consent (or its withdrawal) against the firm's current disclosure. */
export async function POST(request: Request, route: RouteContext<"/api/v1/jobs/[id]/ai-consent">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const parsed = await parseBody(request, consentInput);
  if (!parsed.success) return problem(400, "invalid_request", "The consent record is invalid.", parsed.error.flatten());
  const { id } = await route.params;
  if (context.demo) return problem(409, "ai_disabled", "Demo workspace: AI features are off, so consent cannot be recorded.");
  if (!z.uuid().safeParse(id).success) return problem(404, "job_not_found", "The job could not be found.");
  return governed(() => recordAiConsent(context, id, parsed.data));
}
