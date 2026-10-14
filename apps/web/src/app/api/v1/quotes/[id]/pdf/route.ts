import { apiContext } from "@/lib/access";
import { invalidId, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { pdfResponse } from "@/lib/branded-pdf";
import { practiceQuotePdf } from "@/lib/practice-documents";
export const runtime = "nodejs";

/** The practice-branded quote document. */
export async function GET(request: Request, route: RouteContext<"/api/v1/quotes/[id]/pdf">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (context.role === "surveyor" || context.role === "read_only") return problem(403, "forbidden", "Quote documents are available to practice staff who manage quotes.");
  if (context.demo) return problem(409, "preview_only", "Quote documents are produced for quotes saved in a configured practice.");
  const { id } = await route.params;
  const invalid = invalidId(context, id);
  if (invalid) return invalid;
  const document = await practiceQuotePdf(context, id);
  return document ? pdfResponse(document.bytes, document.filename) : problem(404, "not_found", "The quote could not be found.");
}
