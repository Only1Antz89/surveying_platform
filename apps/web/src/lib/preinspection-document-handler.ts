import { apiContext, canWriteWorkspace } from "./access";
import { ok, problem } from "./api";
import { workspaceApiGuard } from "./workspace-api-guard";
import { PreinspectionError, publicPreinspection, staffPreinspection } from "./preinspection";
import { downloadPreinspectionDocument, listPreinspectionDocuments, uploadPreinspectionDocument } from "./preinspection-documents";
import { getObjectStorage } from "./storage";

export async function handlePreinspectionDocuments(request: Request, id: string, publicAccess: boolean, documentId?: string) {
  const stored = { key: null as string | null };
  try {
    const work = async (...[tx, scope]: Parameters<Parameters<typeof staffPreinspection>[2]>) => documentId ? downloadPreinspectionDocument(tx, scope, documentId) : request.method === "POST" ? uploadPreinspectionDocument(tx, scope, request, stored) : listPreinspectionDocuments(tx, scope);
    let result;
    if (publicAccess) result = await publicPreinspection(id, request.headers.get("x-quote-token") ?? "", request.headers.get("x-questionnaire-token") ?? "", work);
    else {
      const context = await apiContext(request);
      if (!context) return problem(401, "unauthorised", "Sign in to access documents.");
      const denial = await workspaceApiGuard(request, context); if (denial) return denial;
      if (context.demo) return problem(503, "persistent_demo_required", "Private documents require the persistent demo.");
      if (request.method === "POST" && !canWriteWorkspace(context)) return problem(402, "workspace_read_only", "This workspace is read-only.");
      result = await staffPreinspection(context, id, work);
    }
    return result instanceof Response ? result : ok(result);
  } catch (error) {
    if (stored.key) await getObjectStorage()?.remove(stored.key).catch(() => undefined);
    if (error instanceof PreinspectionError) return problem(error.status, error.code, error.message);
    throw error;
  }
}
