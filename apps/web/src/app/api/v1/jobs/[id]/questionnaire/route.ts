import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { PreinspectionError, readPreinspection, revokePreinspectionLinks, staffPreinspection, writePreinspection } from "@/lib/preinspection";
import { QuestionnaireBodyError, readQuestionnaireBody } from "@/lib/questionnaire-body";

async function handle(request: Request, route: RouteContext<"/api/v1/jobs/[id]/questionnaire">) {
  const session = await apiContext(request);
  if (!session) return problem(401, "unauthorised", "Sign in to your practice.");
  const denial = await workspaceApiGuard(request, session);
  if (denial) return denial;
  if (session.demo) return problem(503, "persistent_demo_required", "Use the private persistent demo practice to collect customer statements.");
  if (request.method !== "GET" && !canWriteWorkspace(session)) return problem(403, "workspace_read_only", "The workspace is read-only.");
  if (request.method === "DELETE" && session.role !== "owner") return problem(403, "owner_required", "Only an owner can revoke questionnaire links.");
  const { id } = await route.params;
  try {
    return ok(await staffPreinspection<unknown>(session, id, async (tx, scope) => request.method === "GET" ? readPreinspection(tx, scope) : request.method === "DELETE" ? revokePreinspectionLinks(tx, scope) : writePreinspection(tx, scope, await readQuestionnaireBody(request), request.method === "POST")));
  } catch (error) {
    if (error instanceof PreinspectionError || error instanceof QuestionnaireBodyError) return problem(error.status, error.code, error.message);
    throw error;
  }
}
export const GET = handle;
export const PATCH = handle;
export const POST = handle;
export const DELETE = handle;
