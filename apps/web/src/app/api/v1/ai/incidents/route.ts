import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { incidentInput, reportAiIncident } from "@/lib/ai-governance";
import { governed } from "@/lib/governance-route";

export const runtime = "nodejs";

/** Reports an AI incident. An open critical incident suspends AI use for the firm. */
export async function POST(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const parsed = await parseBody(request, incidentInput);
  if (!parsed.success) return problem(400, "invalid_request", "The incident report is invalid.", parsed.error.flatten());
  if (context.demo) return ok({ ...parsed.data, id: crypto.randomUUID(), status: "open" }, { demo: true, persisted: false });
  return governed(() => reportAiIncident(context, parsed.data));
}
