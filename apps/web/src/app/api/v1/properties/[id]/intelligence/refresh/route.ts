import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { after } from "next/server";
import { z } from "zod";
import { canMutateOperations } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { processIntelligenceRun, requestIntelligenceRefresh } from "@/lib/intelligence";
import { databaseRateGate } from "@/lib/property-identity";
import { createDatabase } from "@surveynt/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const body = z.object({ idempotencyKey: z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/).optional() });

/** Queues an idempotent background refresh. The durable job survives if the post-response work is cut short. */
export async function POST(request: Request, route: RouteContext<"/api/v1/properties/[id]/intelligence/refresh">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before refreshing property intelligence.");
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot refresh property intelligence.");
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return problem(400, "invalid_request", "The refresh request is invalid.");
  const { id } = await route.params;
  if (context.demo) return ok({ runId: "demo-run", status: "completed" }, { demo: true, persisted: false });
  if (!z.uuid().safeParse(id).success) return problem(404, "property_not_found", "The property could not be found.");
  if (!(await databaseRateGate(createDatabase()).acquire(`intelligence_refresh:${context.organisationId}`, 2000, 0))) return problem(429, "rate_limited", "Refreshes are being requested too quickly. Wait a moment and try again.");
  const result = await requestIntelligenceRefresh(context, id, parsed.data);
  if (result.kind === "disabled") return problem(503, "intelligence_disabled", "Property intelligence is not enabled for this deployment.");
  if (result.kind === "missing") return problem(404, "property_not_found", "The property could not be found.");
  if (result.kind === "queued") after(() => processIntelligenceRun(context.organisationId, result.run.id).then(() => undefined, () => undefined));
  return ok({ runId: result.run.id, status: result.run.status, reused: result.kind === "existing" });
}
