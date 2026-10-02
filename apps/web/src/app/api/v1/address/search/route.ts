import { canMutateOperations } from "@surveynt/domain";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { searchAddresses } from "@/lib/property-identity";

export const runtime = "nodejs";

/** Explicit submitted search only. Clients must not call this per keystroke. */
export async function GET(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing workspace records.");
  if (!canMutateOperations(context.role)) return problem(403, "forbidden", "Your role cannot create or edit property records.");
  const query = new URL(request.url).searchParams.get("q") ?? "";
  if (query.length > 200) return problem(400, "invalid_request", "Search text is limited to 200 characters.");
  const result = await searchAddresses({ organisationId: context.organisationId, internalUserId: context.internalUserId, demo: context.demo }, query);
  return ok(result, { demo: result.demo });
}
