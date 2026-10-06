import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { clauseUpdateSchema, retireWording, updateWordingDraft, WordingError } from "@/lib/wording";

export const runtime = "nodejs";

const handle = async <T>(work: () => Promise<T>) => {
  try {
    return ok(await work());
  } catch (reason) {
    if (reason instanceof WordingError) return problem(reason.status, reason.code, reason.message);
    throw reason;
  }
};

/** Edits a draft. Approved wording never changes. */
export async function PATCH(request: Request, route: RouteContext<"/api/v1/wording-clauses/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const parsed = await parseBody(request, clauseUpdateSchema);
  if (!parsed.success) return problem(400, "invalid_request", "The clause is invalid.", parsed.error.flatten());
  const { id } = await route.params;
  if (context.demo) return ok({ id, ...parsed.data }, { demo: true, persisted: false });
  if (!z.uuid().safeParse(id).success) return problem(404, "clause_not_found", "The clause could not be found.");
  return handle(() => updateWordingDraft(context, id, parsed.data));
}

/** Deletes a draft, or retires an approved version (it stays on record). */
export async function DELETE(request: Request, route: RouteContext<"/api/v1/wording-clauses/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const { id } = await route.params;
  if (context.demo) return ok(null, { demo: true, persisted: false });
  if (!z.uuid().safeParse(id).success) return problem(404, "clause_not_found", "The clause could not be found.");
  return handle(() => retireWording(context, id));
}
