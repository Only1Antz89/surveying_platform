import { z } from "zod";
import { apiContext } from "@/lib/access";
import { invalidId, ok, parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { jobReferral, ReferralError, setJobReferral } from "@/lib/referrals";
import { demoReferralSources } from "@/lib/demo-crm";

export async function GET(request: Request, route: RouteContext<"/api/v1/jobs/[id]/referral">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  const { id } = await route.params;
  if (context.demo) return ok({ referralSourceId: id === "job_01" ? "ref-1" : null, sources: demoReferralSources }, { demo: true });
  const invalid = invalidId(context, id);
  if (invalid) return invalid;
  const data = await jobReferral(context, id);
  return data ? ok(data) : problem(404, "not_found", "The job could not be found.");
}
export async function PUT(request: Request, route: RouteContext<"/api/v1/jobs/[id]/referral">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (context.accessLevel !== "full") return problem(403, "read_only", "Changes require an active workspace.");
  const parsed = await parseBody(request, z.object({ referralSourceId: z.string().min(1).max(64).nullable() }));
  if (!parsed.success) return problem(422, "invalid_request", "Choose a referral source.");
  const { id } = await route.params;
  if (context.demo) return ok(parsed.data, { demo: true, persisted: false });
  const invalid = parsed.data.referralSourceId ? invalidId(context, id, parsed.data.referralSourceId) : invalidId(context, id);
  if (invalid) return invalid;
  try { return ok(await setJobReferral(context, id, parsed.data.referralSourceId)); }
  catch (error) { if (error instanceof ReferralError) return problem(error.status, error.code, error.message); throw error; }
}
