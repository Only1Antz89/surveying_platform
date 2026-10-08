import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { demoClauses } from "@/lib/demo-wording";
import { clauseInputSchema, createWordingDraft, listWording, WordingError } from "@/lib/wording";

export const runtime = "nodejs";

/** The firm's wording library: every version of every clause, newest version first. */
export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (context.demo) return ok(demoClauses, { demo: true });
  return ok(await listWording(context));
}

/** Creates a draft clause (a new key, or the next version of an existing one). */
export async function POST(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const parsed = await parseBody(request, clauseInputSchema);
  if (!parsed.success) return problem(400, "invalid_request", "The clause is invalid.", parsed.error.flatten());
  if (context.demo) return ok({ ...parsed.data, id: crypto.randomUUID(), version: 1, status: "draft" }, { demo: true, persisted: false });
  try {
    return ok(await createWordingDraft(context, parsed.data));
  } catch (reason) {
    if (reason instanceof WordingError) return problem(reason.status, reason.code, reason.message);
    throw reason;
  }
}
