import { apiContext } from "@/lib/access";
import { invalidId, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { pdfResponse } from "@/lib/branded-pdf";
import { practiceSignedTermsPdf } from "@/lib/practice-documents";
export const runtime = "nodejs";

/** The signed terms of engagement for a job, with the wording fingerprint. */
export async function GET(request: Request, route: RouteContext<"/api/v1/jobs/[id]/engagement/pdf">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (context.demo) return problem(409, "preview_only", "Signed copies are produced for terms signed in a configured practice.");
  const { id } = await route.params;
  const invalid = invalidId(context, id);
  if (invalid) return invalid;
  const document = await practiceSignedTermsPdf(context, id);
  return document ? pdfResponse(document.bytes, document.filename) : problem(404, "not_signed", "No signed terms are recorded for this job.");
}
