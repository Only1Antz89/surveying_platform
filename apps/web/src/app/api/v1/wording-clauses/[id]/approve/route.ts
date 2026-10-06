import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { approveWording, WordingError } from "@/lib/wording";

export const runtime = "nodejs";

/** Approves a draft (owners and administrators); the previous approved version is retired. */
export async function POST(request: Request, route: RouteContext<"/api/v1/wording-clauses/[id]/approve">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const { id } = await route.params;
  if (context.demo) return ok({ id, status: "approved" }, { demo: true, persisted: false });
  if (!z.uuid().safeParse(id).success) return problem(404, "clause_not_found", "The clause could not be found.");
  try {
    return ok(await approveWording(context, id));
  } catch (reason) {
    if (reason instanceof WordingError) return problem(reason.status, reason.code, reason.message);
    throw reason;
  }
}
