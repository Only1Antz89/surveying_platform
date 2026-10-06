import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { settingsInput, updateAiSettings } from "@/lib/ai-governance";
import { governed } from "@/lib/governance-route";

export const runtime = "nodejs";

/** Owners and administrators turn AI uses on or off and set the client disclosure (off by default). */
export async function PUT(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const parsed = await parseBody(request, settingsInput);
  if (!parsed.success) return problem(400, "invalid_request", "The AI settings are invalid.", parsed.error.flatten());
  if (context.demo) return ok(parsed.data, { demo: true, persisted: false });
  return governed(() => updateAiSettings(context, parsed.data));
}
