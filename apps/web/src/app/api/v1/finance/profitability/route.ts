import { z } from "zod";
import { auditEvents, createDatabase, organisationOperationalSettings, withTenant } from "@surveynt/db";
import { apiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { workspaceAudit } from "@/lib/workspace-audit";
import { JobCostError, practiceProfitability } from "@/lib/job-costs";
import { demoProfitability } from "@/lib/demo-job-costs";

/** Job and service profitability over the last 90 days. */
export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (!["owner", "administrator", "manager", "finance"].includes(context.role)) return problem(403, "forbidden", "Profitability is available to management and finance.");
  if (context.demo) return ok(demoProfitability(), { demo: true });
  try { return ok(await practiceProfitability(context)); }
  catch (error) { if (error instanceof JobCostError) return problem(error.status, error.code, error.message); throw error; }
}

/** Sets the hourly staff cost rate used for profitability. */
export async function PATCH(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (context.accessLevel !== "full" || !["owner", "administrator", "manager"].includes(context.role)) return problem(403, "forbidden", "Practice management access is required.");
  const parsed = await parseBody(request, z.object({ staffCostRatePence: z.number().int().min(0).max(100000) }));
  if (!parsed.success) return problem(422, "invalid_rate", "Enter an hourly cost between £0 and £1,000.");
  if (context.demo) return ok(parsed.data, { demo: true, persisted: false });
  await withTenant(createDatabase(), context.organisationId, async (tx) => {
    await tx.insert(organisationOperationalSettings).values({ organisationId: context.organisationId, staffCostRatePence: parsed.data.staffCostRatePence }).onConflictDoUpdate({ target: organisationOperationalSettings.organisationId, set: { staffCostRatePence: parsed.data.staffCostRatePence, updatedAt: new Date() } });
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "finance.staff_cost_rate_changed", resourceType: "organisation", resourceId: context.organisationId, metadata: parsed.data }));
  });
  return ok(parsed.data);
}
