import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { canMutateOperations } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { resolveCandidate } from "@/lib/property-identity";

export const runtime = "nodejs";

const resolveBody = z.object({ lookupId: z.union([z.uuid(), z.literal("demo")]), index: z.number().int().min(0).max(9) });

/** Returns the selected location (with its confidence) and UPRN candidates. Never selects a UPRN automatically. */
export async function POST(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot create or edit property records.");
  const parsed = await parseBody(request, resolveBody);
  if (!parsed.success) return problem(400, "invalid_request", "Choose one of the search results.", parsed.error.flatten());
  const result = await resolveCandidate({ organisationId: context.organisationId, internalUserId: context.internalUserId, demo: context.demo }, parsed.data.lookupId, parsed.data.index);
  if ("problem" in result) return problem(result.problem === "not_found" ? 404 : 422, result.problem, result.message);
  return ok(result, { demo: result.demo });
}
