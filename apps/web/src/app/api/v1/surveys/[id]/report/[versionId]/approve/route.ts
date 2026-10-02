import { z } from "zod";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { approveReportVersion, ReportError, SIGN_OFF_STATEMENT } from "@/lib/reports";

export const runtime = "nodejs";

/** A surveyor's sign-off of the latest, unchanged report version. Never automatic. */
export async function POST(request: Request, route: RouteContext<"/api/v1/surveys/[id]/report/[versionId]/approve">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const parsed = await parseBody(request, z.object({ confirm: z.literal(true), statement: z.literal(SIGN_OFF_STATEMENT), note: z.string().trim().max(1000).nullable().optional() }));
  if (!parsed.success) return problem(400, "confirmation_required", "Confirm the sign-off statement to approve this version.");
  const { id, versionId } = await route.params;
  if (context.demo) return ok({ approvalId: "demo", versionNumber: 1 }, { demo: true, persisted: false });
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(versionId).success) return problem(404, "report_not_found", "The report version could not be found.");
  try {
    return ok(await approveReportVersion(context, id, versionId, { confirm: true, note: parsed.data.note }));
  } catch (reason) {
    if (reason instanceof ReportError) return problem(reason.status, reason.code, reason.message, reason.details);
    throw reason;
  }
}
