import { apiContext } from "@/lib/access";
import { invalidId, ok, parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { costEntryInput } from "@/lib/job-costs-model";
import { addCostEntry, jobCosts, JobCostError } from "@/lib/job-costs";
import { demoJobCosts } from "@/lib/demo-job-costs";

/** Time, mileage and expenses for a job, with profit for management and finance. */
export async function GET(request: Request, route: RouteContext<"/api/v1/jobs/[id]/costs">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  const { id } = await route.params;
  if (context.demo) return ok(demoJobCosts(id, context.role), { demo: true });
  const invalid = invalidId(context, id);
  if (invalid) return invalid;
  const costs = await jobCosts(context, id);
  return costs ? ok(costs) : problem(404, "not_found", "The job could not be found.");
}

export async function POST(request: Request, route: RouteContext<"/api/v1/jobs/[id]/costs">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (context.accessLevel !== "full") return problem(403, "read_only", "Recording costs requires an active workspace.");
  const parsed = await parseBody(request, costEntryInput);
  if (!parsed.success) return problem(422, "invalid_entry", parsed.error.issues[0]?.message === "Choose a date in the last year." ? "Choose a date in the last year." : "Enter the time, miles or amount and a date.");
  const { id } = await route.params;
  if (context.demo) return ok({ id: `cost-${crypto.randomUUID()}`, ...parsed.data, minutes: parsed.data.kind === "time" ? parsed.data.minutes : null, miles: parsed.data.kind === "mileage" ? parsed.data.miles : null, amountMinor: parsed.data.kind === "expense" ? parsed.data.amountMinor : null, category: parsed.data.kind === "expense" ? parsed.data.category : null, description: parsed.data.description ?? null, userId: "demo_user", userName: "You", createdAt: new Date().toISOString() }, { demo: true, persisted: false });
  const invalid = invalidId(context, id);
  if (invalid) return invalid;
  try { return ok(await addCostEntry(context, id, parsed.data)); }
  catch (error) { if (error instanceof JobCostError) return problem(error.status, error.code, error.message); throw error; }
}
