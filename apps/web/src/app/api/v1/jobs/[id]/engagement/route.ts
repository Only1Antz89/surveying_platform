import { apiContext } from "@/lib/access";
import { invalidId, ok, parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { EngagementError, jobEngagement, practiceSignatureInput, recordPracticeSignature } from "@/lib/engagement-terms";
import { demoJobEngagement } from "@/lib/demo-engagement";

/** Terms of engagement signing status for one job. */
export async function GET(request: Request, route: RouteContext<"/api/v1/jobs/[id]/engagement">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  const { id } = await route.params;
  if (context.demo) return ok(demoJobEngagement(id), { demo: true });
  const invalid = invalidId(context, id);
  if (invalid) return invalid;
  const status = await jobEngagement(context, id);
  return status ? ok(status) : problem(404, "not_found", "The job could not be found.");
}

/** Records terms the client signed on paper or by another agreed method. */
export async function POST(request: Request, route: RouteContext<"/api/v1/jobs/[id]/engagement">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (context.accessLevel !== "full" || !["owner", "administrator", "manager"].includes(context.role)) return problem(403, "forbidden", "Practice management access is required.");
  const parsed = await parseBody(request, practiceSignatureInput);
  if (!parsed.success) return problem(422, "invalid_signature", "Enter who signed, the date they signed and confirm you hold the signed copy.");
  const { id } = await route.params;
  if (context.demo) return ok({ version: 3, signerName: parsed.data.signerName, signedAt: `${parsed.data.signedOn}T12:00:00.000Z`, method: "recorded_by_practice" }, { demo: true, persisted: false });
  const invalid = invalidId(context, id);
  if (invalid) return invalid;
  try { return ok(await recordPracticeSignature(context, id, parsed.data)); }
  catch (error) { if (error instanceof EngagementError) return problem(error.status, error.code, error.message); throw error; }
}
