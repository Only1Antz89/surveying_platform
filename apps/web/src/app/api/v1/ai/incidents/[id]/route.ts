import { z } from "zod";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { updateAiIncident } from "@/lib/ai-governance";
import { governed } from "@/lib/governance-route";

export const runtime = "nodejs";

/** Moves an incident to investigating, corrected or closed (a correction note is required to close). */
export async function PATCH(request: Request, route: RouteContext<"/api/v1/ai/incidents/[id]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  const parsed = await parseBody(request, z.object({ status: z.enum(["investigating", "corrected", "closed"]), correctionNote: z.string().trim().max(4000).nullable().optional() }));
  if (!parsed.success) return problem(400, "invalid_request", "The incident update is invalid.", parsed.error.flatten());
  const { id } = await route.params;
  if (context.demo) return ok({ id, ...parsed.data }, { demo: true, persisted: false });
  if (!z.uuid().safeParse(id).success) return problem(404, "not_found", "The incident could not be found.");
  return governed(() => updateAiIncident(context, id, parsed.data));
}
