import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { parseBody, problem } from "@/lib/api";
import { grantInput, recordContributionGrant } from "@/lib/learning";
import { learningRoute } from "@/lib/learning-route";

export const runtime = "nodejs";

/** Grants (with confirmations) or revokes one contribution scope. Revoking withdraws that scope's material at once. */
export async function POST(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const parsed = await parseBody(request, grantInput);
  if (!parsed.success) return problem(400, "invalid_request", "The contribution setting is invalid.", parsed.error.flatten());
  if (context.demo) return problem(409, "programme_inactive", "Demo workspace: shared learning is not active and nothing can be contributed.");
  return learningRoute(() => recordContributionGrant(context, parsed.data));
}
