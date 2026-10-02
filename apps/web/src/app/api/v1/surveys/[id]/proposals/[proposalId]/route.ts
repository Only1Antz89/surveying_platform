import { z } from "zod";
import { fieldValueSchema } from "@surveynt/assistant";
import { canMutateOperations } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { assistantEnabled } from "@/lib/assistant-flags";
import { reviewProposal } from "@/lib/proposals";

export const runtime = "nodejs";

const review = z.object({
  decision: z.enum(["accept", "edit", "reject"]),
  value: fieldValueSchema.optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  confirmProfessional: z.boolean().optional(),
}).refine((input) => input.decision !== "edit" || input.value !== undefined, "An edited value is required.");

/** Records an authorised review decision. Only acceptance or editing changes the form, and never for a stale suggestion. */
export async function POST(request: Request, route: RouteContext<"/api/v1/surveys/[id]/proposals/[proposalId]">) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot review suggestions.");
  const parsed = await parseBody(request, review);
  if (!parsed.success) return problem(400, "invalid_request", "The review decision is invalid.", parsed.error.flatten());
  const { id, proposalId } = await route.params;
  if (context.demo) return ok({ status: parsed.data.decision === "reject" ? "rejected" : parsed.data.decision === "edit" ? "edited" : "accepted" }, { demo: true, persisted: false });
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(proposalId).success) return problem(404, "proposal_not_found", "The suggestion could not be found.");
  if (!assistantEnabled()) return problem(503, "assistant_disabled", "Suggestions are turned off for this deployment.");
  const result = await reviewProposal({ organisationId: context.organisationId, internalUserId: context.internalUserId, role: context.role }, id, proposalId, parsed.data);
  if (result.kind === "missing") return problem(404, "proposal_not_found", "The suggestion could not be found.");
  if (result.kind === "conflict") return problem(409, "proposal_stale", result.message);
  if (result.kind === "invalid") return problem(422, "proposal_rejected", result.message);
  return ok(result);
}
