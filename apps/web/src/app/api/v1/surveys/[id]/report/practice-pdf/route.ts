import { apiContext } from "@/lib/access";
import { invalidId, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { pdfResponse } from "@/lib/branded-pdf";
import { DocumentError, practiceReportPdf } from "@/lib/practice-documents";
export const runtime = "nodejs";

/** The practice's own report layout for non-RICS work. Watermarked until the latest version is signed off and still current. */
export async function GET(request: Request, route: RouteContext<"/api/v1/surveys/[id]/report/practice-pdf">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Sign in required.");
  const denial = await workspaceApiGuard(request, context);
  if (denial) return denial;
  if (context.demo) return problem(409, "preview_only", "Use “Download printable draft” in the preview. Practice reports are produced from saved report versions.");
  const { id } = await route.params;
  const invalid = invalidId(context, id);
  if (invalid) return invalid;
  try {
    const document = await practiceReportPdf(context, id);
    return document ? pdfResponse(document.bytes, document.filename) : problem(409, "report_required", "Compose a report version first.");
  } catch (error) { if (error instanceof DocumentError) return problem(error.status, error.code, error.message); throw error; }
}
