import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { PreinspectionError, staffPreinspection } from "@/lib/preinspection";
import { confirmDocumentWorks } from "@/lib/preinspection-documents";
export async function POST(request: Request, route: RouteContext<"/api/v1/jobs/[id]/questionnaire/documents/[documentId]/association">) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Sign in to review documents.");
  const denial = await workspaceApiGuard(request, context); if (denial) return denial;
  if (context.demo || !canWriteWorkspace(context)) return problem(403, "workspace_read_only", "A writable persistent workspace is required.");
  const { id, documentId } = await route.params;
  const input = await request.json().catch(() => null);
  try { return ok(await staffPreinspection(context, id, (tx, scope) => confirmDocumentWorks(tx, scope, context, documentId, input))); }
  catch (error) { if (error instanceof PreinspectionError) return problem(error.status, error.code, error.message); throw error; }
}
