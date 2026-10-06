import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { requestWithdrawal, withdrawalInput } from "@/lib/learning";
import { learningRoute } from "@/lib/learning-route";

export const runtime = "nodejs";

/** Withdraws a job or a scope from shared learning; processed immediately when the learning service is configured. */
export async function POST(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const parsed = await parseBody(request, withdrawalInput);
  if (!parsed.success) return problem(400, "invalid_request", "The withdrawal request is invalid.", parsed.error.flatten());
  if (context.demo) return ok({ request: parsed.data, processed: null }, { demo: true, persisted: false });
  return learningRoute(() => requestWithdrawal(context, parsed.data));
}
