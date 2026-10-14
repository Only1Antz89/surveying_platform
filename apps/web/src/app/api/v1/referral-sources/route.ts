import { z } from "zod";
import { apiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { createReferralSource, listReferralSources, ReferralError, referralInput, referralReport, setReferralSourceActive } from "@/lib/referrals";
import { demoReferralReport, demoReferralSources } from "@/lib/demo-crm";

const managers = new Set(["owner", "administrator", "manager"]);
const failure = (error: unknown) => { if (error instanceof ReferralError) return problem(error.status, error.code, error.message); throw error; };
async function guarded(request: Request, write: boolean) {
  const context = await apiContext(request);
  if (!context) return { response: problem(401, "unauthorised", "Sign in required.") };
  const denial = await workspaceApiGuard(request, context);
  if (denial) return { response: denial };
  if (!managers.has(context.role)) return { response: problem(403, "forbidden", "Practice management access is required.") };
  if (write && context.accessLevel !== "full") return { response: problem(403, "read_only", "Changes require an active workspace.") };
  return { context };
}

/** Referral sources with instructions and fees by source over the last 12 months. */
export async function GET(request: Request) {
  const { context, response } = await guarded(request, false);
  if (!context) return response;
  if (context.demo) return ok({ sources: demoReferralSources, ...demoReferralReport() }, { demo: true });
  try { return ok({ sources: await listReferralSources(context), ...await referralReport(context) }); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const { context, response } = await guarded(request, true);
  if (!context) return response;
  const parsed = await parseBody(request, referralInput);
  if (!parsed.success) return problem(422, "invalid_source", "Name the source and choose its type.");
  if (context.demo) return ok({ id: `ref-${crypto.randomUUID()}`, ...parsed.data, email: parsed.data.email ?? null, active: true }, { demo: true, persisted: false });
  try { return ok(await createReferralSource(context, parsed.data)); } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  const { context, response } = await guarded(request, true);
  if (!context) return response;
  const parsed = await parseBody(request, z.object({ id: z.string().min(1).max(64), active: z.boolean() }));
  if (!parsed.success) return problem(422, "invalid_request", "Choose a source.");
  if (context.demo) return ok(parsed.data, { demo: true, persisted: false });
  if (!z.uuid().safeParse(parsed.data.id).success) return problem(404, "not_found", "The referral source could not be found.");
  try { return ok(await setReferralSourceActive(context, parsed.data.id, parsed.data.active)); } catch (error) { return failure(error); }
}
